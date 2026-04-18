// ── CONFIG ─────────────────────────────────────────────────
const SUPABASE_URL      = 'https://swsdbhjfjxnioaqakwuy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0dSKEfF6GANvpFE0JGVeVQ_w64RrAjF';
const ADMIN_SECRET_CODE = 'qwerty';

// ── INIT ───────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── OTP STATE ──────────────────────────────────────────────
let pendingOTPData = null;

// ── REGISTER ───────────────────────────────────────────────
async function initiateRegister(nama, email, password, kelas, role) {
  const [chk, otp] = await Promise.all([
    sb.from('profiles').select('email').eq('email', email).maybeSingle(),
    sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  ]);
  if (chk.data)  return { success: false, error: 'Email sudah terdaftar.' };
  if (otp.error) return { success: false, error: 'Gagal kirim OTP: ' + otp.error.message };
  pendingOTPData = { nama, email, password, kelas, role };
  return { success: true };
}

async function verifyOTPAndRegister(token) {
  if (!pendingOTPData) return { success: false, error: 'Sesi habis. Daftar ulang.' };
  const { nama, email, password, kelas, role } = pendingOTPData;

  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) return { success: false, error: 'OTP salah atau kadaluarsa.' };

  const user   = data.user;
  const status = role === 'admin' ? 'approved' : 'pending';

  const [, up] = await Promise.all([
    sb.auth.updateUser({ password }),
    sb.from('profiles').upsert(
      { user_id: user.id, nama_lengkap: nama, email, kelas, role, status, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    ).select().single()
  ]);

  if (up.error) return { success: false, error: 'Gagal simpan profil: ' + up.error.message };
  pendingOTPData = null;
  return { success: true, user, profile: up.data };
}

async function resendOTPCode() {
  if (!pendingOTPData) return { success: false, error: 'Sesi habis.' };
  const { error } = await sb.auth.signInWithOtp({ email: pendingOTPData.email, options: { shouldCreateUser: true } });
  return error ? { success: false, error: error.message } : { success: true };
}

// ── LOGIN ──────────────────────────────────────────────────
async function loginUser(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    const msg = error.message.includes('Invalid') ? 'Email atau password salah.'
              : error.message.includes('confirm')  ? 'Email belum dikonfirmasi.'
              : 'Login gagal: ' + error.message;
    return { success: false, error: msg };
  }
  const profile = await getProfile(data.user.id);
  if (!profile) { await sb.auth.signOut(); return { success: false, error: 'Profil tidak ditemukan.' }; }
  return { success: true, user: data.user, profile };
}

async function loginWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) showToast('Error', error.message, 'error');
}

async function logoutUser() {
  stopPresence();
  if (currentUser) {
    sb.from('profiles').update({ is_online: false, last_seen: new Date().toISOString() })
      .eq('user_id', currentUser.id).catch(() => {});
  }
  currentUser = currentProfile = null;
  await sb.auth.signOut();
  showPage('page-login');
}

// ── PROFILE ───────────────────────────────────────────────
async function getProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('user_id', userId).maybeSingle();
  if (error) console.warn('getProfile:', error.message);
  return data || null;
}

async function ensureProfile(user) {
  const p = await getProfile(user.id);
  if (p) return p;
  const nama = user.user_metadata?.full_name || user.user_metadata?.name || user.email.split('@')[0];
  const { data } = await sb.from('profiles').insert({
    user_id: user.id, nama_lengkap: nama, email: user.email, kelas: '8F', role: 'siswa', status: 'pending'
  }).select().single();
  return data || null;
}

// ── PRESENCE ──────────────────────────────────────────────
let presenceTimer = null;
function startPresence() {
  if (!currentUser || presenceTimer) return;
  const ping = () => sb.from('profiles')
    .update({ is_online: true, last_seen: new Date().toISOString() })
    .eq('user_id', currentUser.id).catch(() => {});
  ping();
  presenceTimer = setInterval(ping, 30000);
  if (!window._presenceUnload) {
    window._presenceUnload = true;
    window.addEventListener('beforeunload', () => {
      sb.from('profiles').update({ is_online: false }).eq('user_id', currentUser?.id).catch(() => {});
    });
  }
}
function stopPresence() {
  if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
}

// ── QUERIES ────────────────────────────────────────────────
const getAllUsers  = ()   => sb.from('profiles').select('*').order('created_at', { ascending: false });
const getMapel    = ()   => sb.from('mapel').select('*').order('urutan');
const getKisiKisi = (id) => sb.from('kisi_kisi').select('*').eq('mapel_id', id).order('urutan');

async function updateUserStatus(id, status) {
  const { error } = await sb.from('profiles').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  if (!error) logAdminAction('status_update:' + status, id);
  return { success: !error, error: error?.message };
}
async function toggleMapelLock(id, locked) {
  const { error } = await sb.from('mapel').update({ is_locked: locked }).eq('id', id);
  return { success: !error, error: error?.message };
}
async function createMapel(d)       { const { data, error } = await sb.from('mapel').insert(d).select().single(); return { success: !error, data, error: error?.message }; }
async function updateMapel(id, d)   { const { error } = await sb.from('mapel').update(d).eq('id', id); return { success: !error, error: error?.message }; }
async function deleteMapel(id)      { const { error } = await sb.from('mapel').delete().eq('id', id); return { success: !error, error: error?.message }; }
async function createKisiKisi(d)    { const { data, error } = await sb.from('kisi_kisi').insert(d).select().single(); return { success: !error, data, error: error?.message }; }
async function updateKisiKisi(id,d) { const { error } = await sb.from('kisi_kisi').update({ ...d, updated_at: new Date().toISOString() }).eq('id', id); return { success: !error, error: error?.message }; }
async function deleteKisiKisi(id)   { const { error } = await sb.from('kisi_kisi').delete().eq('id', id); return { success: !error, error: error?.message }; }

async function banUser(id, type, reason) {
  const ban_until = type === 'temp' ? new Date(Date.now() + 86400000).toISOString() : null;
  const { error } = await sb.from('profiles').update({ status:'rejected', ban_type:type, ban_until, ban_reason:reason, updated_at:new Date().toISOString() }).eq('id', id);
  if (!error) logAdminAction('ban:' + type, id, reason);
  return { success: !error, error: error?.message };
}
async function unbanUser(id) {
  const { error } = await sb.from('profiles').update({ status:'approved', ban_type:null, ban_until:null, ban_reason:null, updated_at:new Date().toISOString() }).eq('id', id);
  if (!error) logAdminAction('unban', id);
  return { success: !error, error: error?.message };
}

// ── LOGS ──────────────────────────────────────────────────
function logAdminAction(action, targetId, detail) {
  if (!currentUser) return;
  sb.from('activity_log').insert({ user_id: currentUser.id, action, detail: detail ? `${targetId}: ${detail}` : String(targetId) }).catch(() => {});
}
async function getAdminLogs() {
  return sb.from('activity_log').select('*, profiles!activity_log_user_id_fkey(nama_lengkap,email)').order('created_at', { ascending: false }).limit(100);
}

// ── BROADCAST ────────────────────────────────────────────
async function getBroadcasts() {
  return sb.from('broadcasts').select('*').eq('active', true).order('created_at', { ascending: false });
}
async function createBroadcast(title, body, scheduleAt) {
  const p = { title, body, active: true, created_by: currentUser?.id };
  if (scheduleAt) p.scheduled_at = scheduleAt;
  const { data, error } = await sb.from('broadcasts').insert(p).select().single();
  return { success: !error, data, error: error?.message };
}
async function deleteBroadcast(id) {
  const { error } = await sb.from('broadcasts').update({ active: false }).eq('id', id);
  return { success: !error, error: error?.message };
}

// ── REALTIME ──────────────────────────────────────────────
const subscribeToProfiles   = (cb) => sb.channel('profiles-ch').on('postgres_changes', { event:'*', schema:'public', table:'profiles' }, cb).subscribe();
const subscribeToMapel      = (cb) => sb.channel('mapel-ch').on('postgres_changes', { event:'*', schema:'public', table:'mapel' }, cb).subscribe();
const subscribeToBroadcasts = (cb) => sb.channel('broadcast-ch').on('postgres_changes', { event:'INSERT', schema:'public', table:'broadcasts' }, cb).subscribe();
