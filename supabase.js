// ── CONFIG ─────────────────────────────────────────────────
const SUPABASE_URL      = 'https://swsdbhjfjxnioaqakwuy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0dSKEfF6GANvpFE0JGVeVQ_w64RrAjF';
const ADMIN_SECRET_CODE = 'qwerty';

// ── INIT ───────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── OTP PENDING STATE ──────────────────────────────────────
let pendingOTPData = null;

// ── REGISTER ───────────────────────────────────────────────
async function initiateRegister(nama, email, password, kelas, role) {
  // Run email-exists check and OTP send in parallel — saves ~500ms round-trip
  const [existsRes, otpRes] = await Promise.all([
    sb.from('profiles').select('email').eq('email', email).maybeSingle(),
    sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  ]);
  if (existsRes.data) return { success: false, error: 'Email sudah terdaftar.' };
  if (otpRes.error) return { success: false, error: 'Gagal kirim OTP: ' + otpRes.error.message };
  pendingOTPData = { nama, email, password, kelas, role };
  return { success: true };
}

async function verifyOTPAndRegister(inputOTP) {
  if (!pendingOTPData) return { success: false, error: 'Sesi habis. Daftar ulang.' };

  const { nama, email, password, kelas, role } = pendingOTPData;

  const { data, error } = await sb.auth.verifyOtp({
    email, token: inputOTP, type: 'email'
  });
  if (error) return { success: false, error: 'OTP salah atau kadaluarsa.' };

  const user = data.user;
  const status = role === 'admin' ? 'approved' : 'pending';
  const now = new Date().toISOString();

  // Run password update + profile upsert in parallel — saves ~1 extra round-trip
  const [, upsertResult] = await Promise.all([
    sb.auth.updateUser({ password }),
    sb.from('profiles').upsert(
      { user_id: user.id, nama_lengkap: nama, email, kelas, role, status, updated_at: now },
      { onConflict: 'user_id', ignoreDuplicates: false }
    ).select().single()
  ]);

  if (upsertResult.error) {
    return { success: false, error: 'Gagal buat profil: ' + upsertResult.error.message };
  }

  pendingOTPData = null;
  // Use the upserted row directly — no extra getProfile() round-trip needed
  const profile = upsertResult.data;
  return { success: true, user, profile };
}

async function resendOTPCode() {
  if (!pendingOTPData) return { success: false, error: 'Sesi habis.' };
  const { error } = await sb.auth.signInWithOtp({
    email: pendingOTPData.email,
    options: { shouldCreateUser: true }
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── LOGIN ──────────────────────────────────────────────────
async function loginUser(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = error.message.includes('Invalid')
      ? 'Email atau password salah.'
      : error.message.includes('confirm')
      ? 'Email belum dikonfirmasi.'
      : 'Login gagal.';
    return { success: false, error: msg };
  }
  const profile = await getProfile(data.user.id);
  if (!profile) {
    await sb.auth.signOut();
    return { success: false, error: 'Profil tidak ditemukan.' };
  }
  return { success: true, user: data.user, profile };
}

async function loginWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showToast('Error', error.message, 'error');
}

async function logoutUser() {
  stopPresence();
  if (currentUser) {
    // fire-and-forget — don't await, show UI instantly
    sb.from('profiles').update({ last_seen: new Date().toISOString(), is_online: false })
      .eq('user_id', currentUser.id).catch(() => {});
  }
  await sb.auth.signOut();
  currentUser = currentProfile = null;
  showPage('page-login');
}

// ── PROFILE ───────────────────────────────────────────────
async function getProfile(userId) {
  try {
    const { data, error } = await sb.from('profiles')
      .select('*').eq('user_id', userId).maybeSingle();
    if (error) { console.error('getProfile error:', error.message); return null; }
    return data;
  } catch(e) { console.error('getProfile exception:', e); return null; }
}

async function ensureProfile(user) {
  const existing = await getProfile(user.id);
  if (existing) return existing;
  const nama = user.user_metadata?.full_name
    || user.user_metadata?.name
    || user.email.split('@')[0];
  const { data } = await sb.from('profiles').insert({
    user_id: user.id, nama_lengkap: nama,
    email: user.email, kelas: '8F', role: 'siswa', status: 'pending'
  }).select().single();
  return data || null;
}

// ── USER PRESENCE (heartbeat) ─────────────────────────────
let presenceInterval = null;
let _presenceListenerAdded = false;
function startPresence() {
  if (!currentUser || presenceInterval) return;
  const update = () => sb.from('profiles')
    .update({ last_seen: new Date().toISOString(), is_online: true })
    .eq('user_id', currentUser.id).catch(() => {});
  update(); // fire-and-forget, no await
  presenceInterval = setInterval(update, 30000);
  if (!_presenceListenerAdded) {
    _presenceListenerAdded = true;
    window.addEventListener('beforeunload', () => {
      sb.from('profiles').update({ is_online: false })
        .eq('user_id', currentUser.id).catch(() => {});
    });
  }
}

function stopPresence() {
  if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; }
}

// ── ADMIN CRUD ────────────────────────────────────────────
const getAllUsers  = () => sb.from('profiles').select('*').order('created_at', { ascending: false });
const getMapel    = () => sb.from('mapel').select('*').order('urutan');
const getKisiKisi = (id) => sb.from('kisi_kisi').select('*').eq('mapel_id', id).order('urutan');

async function updateUserStatus(id, status) {
  const { error } = await sb.from('profiles')
    .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  // Log action
  if (!error) await logAdminAction(`status_update:${status}`, id);
  return { success: !error, error: error?.message };
}

async function toggleMapelLock(id, locked) {
  const { error } = await sb.from('mapel').update({ is_locked: locked }).eq('id', id);
  return { success: !error, error: error?.message };
}

// ── MAPEL CRUD ────────────────────────────────────────────
async function createMapel(data) {
  const { data: res, error } = await sb.from('mapel').insert(data).select().single();
  return { success: !error, data: res, error: error?.message };
}

async function updateMapel(id, data) {
  const { error } = await sb.from('mapel').update(data).eq('id', id);
  return { success: !error, error: error?.message };
}

async function deleteMapel(id) {
  const { error } = await sb.from('mapel').delete().eq('id', id);
  return { success: !error, error: error?.message };
}

// ── KISI-KISI (SOAL) CRUD ─────────────────────────────────
async function createKisiKisi(data) {
  const { data: res, error } = await sb.from('kisi_kisi').insert(data).select().single();
  return { success: !error, data: res, error: error?.message };
}

async function updateKisiKisi(id, data) {
  const { error } = await sb.from('kisi_kisi')
    .update({ ...data, updated_at: new Date().toISOString() }).eq('id', id);
  return { success: !error, error: error?.message };
}

async function deleteKisiKisi(id) {
  const { error } = await sb.from('kisi_kisi').delete().eq('id', id);
  return { success: !error, error: error?.message };
}

// ── BAN / BLOCK ───────────────────────────────────────────
async function banUser(id, type, reason) {
  // type: 'temp' | 'permanent'
  const bannedUntil = type === 'temp'
    ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() // 24 jam
    : null;
  const { error } = await sb.from('profiles').update({
    status: 'rejected',
    ban_type: type,
    ban_until: bannedUntil,
    ban_reason: reason,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  if (!error) await logAdminAction(`ban:${type}`, id, reason);
  return { success: !error, error: error?.message };
}

async function unbanUser(id) {
  const { error } = await sb.from('profiles').update({
    status: 'approved',
    ban_type: null,
    ban_until: null,
    ban_reason: null,
    updated_at: new Date().toISOString()
  }).eq('id', id);
  if (!error) await logAdminAction('unban', id);
  return { success: !error, error: error?.message };
}

// ── ACTIVITY LOG ──────────────────────────────────────────
async function logAdminAction(action, targetId, detail) {
  if (!currentUser) return;
  await sb.from('activity_log').insert({
    user_id: currentUser.id,
    action,
    detail: detail ? `${targetId}: ${detail}` : targetId,
  }).catch(() => {});
}

async function getAdminLogs() {
  return await sb.from('activity_log')
    .select('*, profiles!activity_log_user_id_fkey(nama_lengkap, email)')
    .order('created_at', { ascending: false })
    .limit(100);
}

// ── BROADCAST ────────────────────────────────────────────
async function getBroadcasts() {
  return await sb.from('broadcasts').select('*')
    .eq('active', true).order('created_at', { ascending: false });
}

async function createBroadcast(title, body, scheduleAt) {
  const payload = {
    title, body, active: true,
    created_by: currentUser?.id,
  };
  if (scheduleAt) payload.scheduled_at = scheduleAt;
  const { data, error } = await sb.from('broadcasts').insert(payload).select().single();
  return { success: !error, data, error: error?.message };
}

async function deleteBroadcast(id) {
  const { error } = await sb.from('broadcasts')
    .update({ active: false }).eq('id', id);
  return { success: !error, error: error?.message };
}

// ── REALTIME ──────────────────────────────────────────────
const subscribeToProfiles = (cb) => sb.channel('profiles-ch')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, cb)
  .subscribe();

const subscribeToMapel = (cb) => sb.channel('mapel-ch')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'mapel' }, cb)
  .subscribe();

const subscribeToBroadcasts = (cb) => sb.channel('broadcast-ch')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcasts' }, cb)
  .subscribe();
