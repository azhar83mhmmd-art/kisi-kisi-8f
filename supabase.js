// ── CONFIG ─────────────────────────────────────────────────
const SUPABASE_URL      = 'https://eozszgqcjrtcddzhhrla.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_i03TX3TX6zL7_dpSK6IF4w_T87lfQAP';
const ADMIN_SECRET_CODE = 'qwerty';
// ⚠️ PENTING: Set OTP length = 8 di Supabase Dashboard
//    Authentication → Email Templates → OTP Length → 8

// ── INIT ───────────────────────────────────────────────────
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── OTP PENDING STATE ──────────────────────────────────────
let pendingOTPData = null;

// ── REGISTER — kirim OTP via Supabase built-in ─────────────
// role: 'siswa' | 'admin'
async function initiateRegister(nama, email, password, kelas, role) {
  // Cek email sudah terdaftar
  const { data: ex } = await sb.from('profiles')
    .select('email').eq('email', email).maybeSingle();
  if (ex) return { success: false, error: 'Email sudah terdaftar.' };

  // Simpan data pending
  pendingOTPData = { nama, email, password, kelas, role };

  // Kirim OTP 6-digit via Supabase (magic link / OTP email)
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });

  if (error) return { success: false, error: 'Gagal kirim OTP: ' + error.message };
  return { success: true };
}

// ── VERIFY OTP & SELESAIKAN REGISTRASI ────────────────────
async function verifyOTPAndRegister(inputOTP) {
  if (!pendingOTPData) return { success: false, error: 'Sesi habis. Daftar ulang.' };

  const { nama, email, password, kelas, role } = pendingOTPData;

  // Verifikasi OTP ke Supabase
  const { data, error } = await sb.auth.verifyOtp({
    email,
    token: inputOTP,
    type: 'email'
  });
  if (error) return { success: false, error: 'OTP salah atau kadaluarsa.' };

  const user = data.user;

  // Set password akun
  await sb.auth.updateUser({ password });

  // Admin → langsung approved, siswa → pending
  const status = role === 'admin' ? 'approved' : 'pending';

  // Upsert profil
  const { data: existingP } = await sb.from('profiles')
    .select('id').eq('user_id', user.id).maybeSingle();

  if (existingP) {
    await sb.from('profiles').update({
      nama_lengkap: nama, kelas, role, status,
      updated_at: new Date().toISOString()
    }).eq('user_id', user.id);
  } else {
    const { error: pe } = await sb.from('profiles').insert({
      user_id: user.id, nama_lengkap: nama, email, kelas, role, status
    });
    if (pe) return { success: false, error: 'Gagal buat profil: ' + pe.message };
  }

  pendingOTPData = null;
  const profile = await getProfile(user.id);
  return { success: true, user, profile };
}

// ── KIRIM ULANG OTP ────────────────────────────────────────
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
      ? 'Email belum dikonfirmasi. Cek inbox Anda.'
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

// ── GOOGLE OAUTH ──────────────────────────────────────────
async function loginWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showToast('Error', error.message, 'error');
}

// ── LOGOUT ────────────────────────────────────────────────
async function logoutUser() {
  await sb.auth.signOut();
  currentUser = currentProfile = null;
  showPage('page-login');
}

// ── PROFILE ───────────────────────────────────────────────
async function getProfile(userId) {
  const { data } = await sb.from('profiles')
    .select('*').eq('user_id', userId).maybeSingle();
  return data;
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

// ── ADMIN CRUD ────────────────────────────────────────────
const getAllUsers  = () => sb.from('profiles').select('*').order('created_at', { ascending: false });
const getMapel    = () => sb.from('mapel').select('*').order('urutan');
const getKisiKisi = (id) => sb.from('kisi_kisi').select('*').eq('mapel_id', id).order('urutan');

async function updateUserStatus(id, status) {
  const { error } = await sb.from('profiles')
    .update({ status, updated_at: new Date().toISOString() }).eq('id', id);
  return { success: !error, error: error?.message };
}

async function toggleMapelLock(id, locked) {
  const { error } = await sb.from('mapel').update({ is_locked: locked }).eq('id', id);
  return { success: !error, error: error?.message };
}

// ── REALTIME ──────────────────────────────────────────────
const subscribeToProfiles = (cb) => sb.channel('profiles-ch')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, cb)
  .subscribe();
const subscribeToMapel = (cb) => sb.channel('mapel-ch')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'mapel' }, cb)
  .subscribe();
