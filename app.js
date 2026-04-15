// =================== CONFIG ===================
// Ganti dengan kredensial Supabase Anda
const SUPABASE_URL = 'https://lqsunpvtuptpiuytfqoc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_C5vITqakqalx2k154xxD_w_obESyq78';

// EmailJS config
const EMAILJS_SERVICE_ID = 'service_pyimyzb';
const EMAILJS_TEMPLATE_APPROVED = 'akun berhasil di buat';
const EMAILJS_TEMPLATE_REJECTED = 'wkwk di tolak mampus';
const EMAILJS_TEMPLATE_PENDING = 'mohon tunggu';
const EMAILJS_PUBLIC_KEY = 'HAzuBBggwHvM8b1YU';

// =================== INIT ===================
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentUserData = null;
let activeSubject = null;
let countdownTimers = {};

const SUBJECTS = [
  { name: 'Matematika', icon: '🔢' },
  { name: 'Bahasa Indonesia', icon: '📝' },
  { name: 'Bahasa Inggris', icon: '🌐' },
  { name: 'IPA', icon: '🔬' },
  { name: 'IPS', icon: '🌍' },
  { name: 'PPKn', icon: '🏛️' },
  { name: 'Informatika', icon: '💻' },
  { name: 'Seni Budaya', icon: '🎨' },
  { name: 'PJOK', icon: '⚽' },
  { name: 'Prakarya', icon: '🛠️' },
];

// =================== TOAST ===================
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast-item toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// =================== SHOW PAGE ===================
function showPage(id) {
  document.querySelectorAll('.page, .dashboard-page').forEach(p => {
    p.classList.remove('active');
    if (p.classList.contains('dashboard-page')) p.style.display = 'none';
  });
  const page = document.getElementById('page-' + id);
  if (!page) return;
  if (page.classList.contains('page')) {
    page.classList.add('active');
    document.getElementById('navbar').style.display = 'none';
  } else {
    page.style.display = 'block';
    page.classList.add('active');
    document.getElementById('navbar').style.display = 'flex';
  }
}

// =================== AUTH ===================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) =>
    b.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1))
  );
  document.getElementById('tab-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'block' : 'none';
  clearAlerts();
}

function showAlert(id, msg, type = 'error') {
  const el = document.getElementById(id);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}
function clearAlerts() {
  document.querySelectorAll('.alert').forEach(a => { a.classList.remove('show'); a.textContent = ''; });
}

function regStep2() {
  const nama = document.getElementById('reg-nama').value.trim();
  const kelas = document.getElementById('reg-kelas').value;
  const kode = document.getElementById('reg-kode').value.trim();
  if (!nama || !kelas || !kode) { showAlert('alert-reg', 'Semua field wajib diisi.'); return; }
  document.getElementById('reg-step1').style.display = 'none';
  document.getElementById('reg-step2').style.display = 'block';
  clearAlerts();
}
function backStep1() {
  document.getElementById('reg-step2').style.display = 'none';
  document.getElementById('reg-step1').style.display = 'block';
}

async function doRegister() {
  const nama = document.getElementById('reg-nama').value.trim();
  const kelas = document.getElementById('reg-kelas').value;
  const kode = document.getElementById('reg-kode').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw = document.getElementById('reg-pw').value;

  if (!email || !pw) { showAlert('alert-reg', 'Email dan password wajib diisi.'); return; }
  if (pw.length < 6) { showAlert('alert-reg', 'Password minimal 6 karakter.'); return; }

  const btn = document.getElementById('btn-reg');
  btn.disabled = true; btn.textContent = 'Mendaftarkan...';

  try {
    const { data: authData, error: authErr } = await sb.auth.signUp({ email, password: pw });
    if (authErr) throw authErr;

    const uid = authData.user?.id;
    const { error: dbErr } = await sb.from('users').insert({
      id: uid, nama, email, kelas, kode_input: kode,
      status: 'pending', role: 'siswa', password: '[hashed_by_auth]'
    });
    if (dbErr && !dbErr.message.includes('duplicate')) throw dbErr;

    sendEmail('pending', email, nama).catch(() => {});
    showPage('pending');
    toast('Pendaftaran berhasil dikirim! 🎉', 'success');
  } catch (e) {
    showAlert('alert-reg', 'Terjadi kesalahan. Coba lagi atau hubungi admin.');
    console.error(e);
  }
  btn.disabled = false; btn.textContent = 'Daftarkan Akun';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-pw').value;
  if (!email || !pw) { showAlert('alert-login', 'Isi email dan password.'); return; }

  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Masuk...';

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) throw error;
    await loadUserAndRoute(data.user);
  } catch (e) {
    showAlert('alert-login', 'Email atau password salah. Periksa kembali.');
  }
  btn.disabled = false; btn.textContent = 'Masuk Sekarang';
}

async function doLogout() {
  await sb.auth.signOut();
  currentUser = null; currentUserData = null;
  Object.values(countdownTimers).forEach(clearInterval);
  countdownTimers = {};
  showPage('auth');
}

// =================== ROUTE ===================
// BUG FIX: Admin yang belum ada di tabel users sebelumnya akan logout paksa.
// Sekarang: jika tidak ada di tabel users, cek apakah email adalah admin,
// jika belum terdaftar di tabel users maka logout, TAPI jika ada di tabel users
// dengan role=admin maka lanjutkan ke dashboard admin.
async function loadUserAndRoute(user) {
  currentUser = user;

  // Query berdasarkan user.id (lebih aman dari email)
  let { data: ud, error: udErr } = await sb.from('users').select('*').eq('id', user.id).single();

  // Fallback: cari berdasarkan email jika tidak ketemu dengan id
  if (!ud || udErr) {
    const { data: udByEmail } = await sb.from('users').select('*').eq('email', user.email).single();
    ud = udByEmail;

    // Jika ditemukan dengan email tapi id berbeda, update id-nya
    if (ud && ud.id !== user.id) {
      await sb.from('users').update({ id: user.id }).eq('email', user.email);
      ud.id = user.id;
    }
  }

  if (!ud) {
    // User tidak ada di tabel users — bisa jadi admin yang belum dimasukkan ke tabel
    // atau user yang gagal mendaftar. Logout untuk keamanan.
    toast('Akun tidak ditemukan. Hubungi admin.', 'error');
    await doLogout();
    return;
  }

  currentUserData = ud;

  // Set navbar
  document.getElementById('nav-user-name').textContent = ud.nama || ud.email;
  const badge = document.getElementById('nav-role-badge');
  badge.textContent = ud.role === 'admin' ? 'Admin' : 'Siswa';
  badge.className = `nav-badge ${ud.role === 'admin' ? 'badge-admin' : 'badge-siswa'}`;

  // Route berdasarkan role dan status
  if (ud.role === 'admin' && ud.status === 'approved') {
    showPage('admin');
    loadAdminData();
    subscribeAdmin();
    subscribeAdminKisi();
  } else if (ud.role === 'admin' && ud.status !== 'approved') {
    // Admin tapi status belum approved — tampilkan pending
    showPage('pending');
    toast('Akun admin belum diaktifkan. Jalankan SQL di Supabase untuk mengaktifkan.', 'error');
  } else if (ud.status === 'approved') {
    showPage('siswa');
    loadSubjectGrid();
    subscribeUserStatus();
  } else if (ud.status === 'rejected') {
    showPage('rejected');
  } else {
    showPage('pending');
    subscribeUserStatus();
  }
}

// =================== REALTIME: USER STATUS ===================
function subscribeUserStatus() {
  sb.channel('user-status-' + currentUserData.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${currentUserData.id}` },
      payload => {
        const s = payload.new.status;
        if (s === 'approved') {
          toast('Akun Anda telah disetujui! 🎉', 'success');
          currentUserData = payload.new;
          showPage('siswa');
          loadSubjectGrid();
        } else if (s === 'rejected') {
          toast('Akun Anda ditolak.', 'error');
          showPage('rejected');
        }
      }).subscribe();
}

// =================== SISWA: SUBJECT GRID ===================
async function loadSubjectGrid() {
  const grid = document.getElementById('subject-grid');
  grid.innerHTML = '';

  const { data: counts } = await sb.from('kisi_kisi').select('mata_pelajaran');
  const countMap = {};
  (counts || []).forEach(r => { countMap[r.mata_pelajaran] = (countMap[r.mata_pelajaran] || 0) + 1; });

  SUBJECTS.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'subject-card fade-up';
    div.style.animationDelay = `${i * 0.04}s`;
    div.style.opacity = '0';
    div.innerHTML = `
      <span class="subject-icon">${s.icon}</span>
      <div class="subject-name">${s.name}</div>
      <div class="subject-count">${countMap[s.name] || 0} kisi-kisi</div>
    `;
    div.onclick = () => loadKisi(s.name, div);
    grid.appendChild(div);
  });
}

async function loadKisi(mapel, card) {
  document.querySelectorAll('.subject-card').forEach(c => c.classList.remove('active-sub'));
  if (card) card.classList.add('active-sub');
  activeSubject = mapel;

  document.getElementById('kisi-section').style.display = 'block';
  document.getElementById('kisi-loading').style.display = 'flex';
  document.getElementById('kisi-grid').innerHTML = '';
  document.getElementById('kisi-section-title').textContent = `${SUBJECTS.find(s => s.name === mapel)?.icon || '📖'} ${mapel}`;

  const { data } = await sb.from('kisi_kisi').select('*').eq('mata_pelajaran', mapel).order('tanggal_buka');
  document.getElementById('kisi-loading').style.display = 'none';
  renderKisiGrid(data || [], 'kisi-grid', false);

  sb.channel('kisi-siswa-' + mapel)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kisi_kisi' },
      async () => {
        const { data: d } = await sb.from('kisi_kisi').select('*').eq('mata_pelajaran', activeSubject).order('tanggal_buka');
        renderKisiGrid(d || [], 'kisi-grid', false);
      }).subscribe();
}

function renderKisiGrid(items, targetId, isAdmin) {
  const grid = document.getElementById(targetId);
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = `<div class="empty-state"><span class="empty-state-icon">📭</span><p>Belum ada kisi-kisi tersedia.</p></div>`;
    return;
  }
  items.forEach((item, i) => {
    const now = new Date();
    const buka = item.tanggal_buka ? new Date(item.tanggal_buka) : null;
    const locked = buka && buka > now;
    const card = document.createElement('div');
    card.className = `kisi-card fade-up${locked ? ' locked' : ''}`;
    card.style.animationDelay = `${i * 0.06}s`;
    card.style.opacity = '0';
    card.dataset.id = item.id;

    let lockOverlay = '';
    if (locked) {
      lockOverlay = `
        <div class="lock-overlay">
          <span class="lock-icon">🔒</span>
          <div class="countdown" id="cd-${item.id}">Menghitung...</div>
        </div>
      `;
    }

    const delBtn = isAdmin
      ? `<div style="margin-top:16px"><button class="btn btn-danger btn-sm" onclick="deleteKisi('${item.id}')">🗑️ Hapus</button></div>`
      : '';

    card.innerHTML = `
      <div class="kisi-header">
        <span class="kisi-mapel-tag">${item.mata_pelajaran}</span>
        ${locked
          ? '<span class="kisi-status-lock">🔒 Terkunci</span>'
          : '<span class="kisi-status-open">🔓 Terbuka</span>'
        }
      </div>
      <div class="kisi-title">${item.judul}</div>
      <div class="kisi-body${locked && !isAdmin ? ' blurred' : ''}">${item.isi}</div>
      <div class="kisi-date">📅 ${buka ? buka.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' }) : 'Selalu terbuka'}</div>
      ${delBtn}
      ${lockOverlay}
    `;
    grid.appendChild(card);

    if (locked && !isAdmin) startCountdown(item.id, buka);
  });
}

function startCountdown(id, targetDate) {
  if (countdownTimers[id]) clearInterval(countdownTimers[id]);
  const getEl = () => document.getElementById(`cd-${id}`);
  const update = () => {
    const diff = targetDate - new Date();
    if (diff <= 0) {
      clearInterval(countdownTimers[id]);
      loadKisi(activeSubject, null);
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const txt = d > 0 ? `${d}h ${h}j ${m}m` : `${h}j ${m}m ${s}d`;
    const el = getEl();
    if (el) el.textContent = `Buka dalam ${txt}`;
  };
  update();
  countdownTimers[id] = setInterval(update, 1000);
}

// =================== ADMIN ===================
async function loadAdminData() {
  const { data: users } = await sb.from('users').select('*').order('created_at', { ascending: false });
  renderAdminUsers(users || []);
  loadAdminKisi();
}

function renderAdminUsers(users) {
  const body = document.getElementById('admin-users-body');
  body.innerHTML = '';

  document.getElementById('stat-total').textContent = users.length;
  document.getElementById('stat-pending').textContent = users.filter(u => u.status === 'pending').length;
  document.getElementById('stat-approved').textContent = users.filter(u => u.status === 'approved').length;

  if (!users.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px">Belum ada pendaftar.</td></tr>`;
    return;
  }
  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.id = `row-${u.id}`;
    const statusLabel = u.status === 'pending' ? 'Menunggu' : u.status === 'approved' ? 'Disetujui' : 'Ditolak';
    const statusIcon = u.status === 'pending' ? '⏳' : u.status === 'approved' ? '✅' : '❌';
    tr.innerHTML = `
      <td style="font-weight:600">${u.nama || '-'}</td>
      <td style="color:var(--text-muted)">${u.email}</td>
      <td>${u.kelas || '-'}</td>
      <td><code class="kode-display">${u.kode_input || '-'}</code></td>
      <td style="color:var(--text-muted);font-size:12px">${new Date(u.created_at).toLocaleDateString('id-ID')}</td>
      <td><span class="pill pill-${u.status}">${statusIcon} ${statusLabel}</span></td>
      <td>
        <div class="action-group">
          ${u.status !== 'approved' ? `<button class="btn btn-success btn-sm" onclick="approveUser('${u.id}','${u.email}','${u.nama}')">✅ Setujui</button>` : ''}
          ${u.status !== 'rejected' ? `<button class="btn btn-danger btn-sm" onclick="rejectUser('${u.id}','${u.email}','${u.nama}')">❌ Tolak</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="resendEmail('${u.email}','${u.nama}','${u.status}')" title="Kirim ulang email">📩</button>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

function subscribeAdmin() {
  sb.channel('admin-users-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' },
      async () => {
        const { data } = await sb.from('users').select('*').order('created_at', { ascending: false });
        renderAdminUsers(data || []);
      }).subscribe();
}

async function approveUser(id, email, nama) {
  await sb.from('users').update({ status: 'approved' }).eq('id', id);
  sendEmail('approved', email, nama);
  toast(`${nama} disetujui ✅`, 'success');
}
async function rejectUser(id, email, nama) {
  await sb.from('users').update({ status: 'rejected' }).eq('id', id);
  sendEmail('rejected', email, nama);
  toast(`${nama} ditolak`, 'error');
}
function resendEmail(email, nama, status) {
  sendEmail(status, email, nama);
  toast('Email dikirim ulang 📩', 'info');
}

// =================== EMAIL ===================
function sendEmail(type, email, nama) {
  emailjs.init(EMAILJS_PUBLIC_KEY);
  const params = { to_email: email, nama };
  const templates = {
    approved: EMAILJS_TEMPLATE_APPROVED,
    rejected: EMAILJS_TEMPLATE_REJECTED,
    pending: EMAILJS_TEMPLATE_PENDING,
  };
  return emailjs.send(EMAILJS_SERVICE_ID, templates[type], params)
    .then(() => console.log('Email sent:', type))
    .catch(e => console.warn('Email error:', e));
}

// =================== ADMIN KISI ===================
async function loadAdminKisi() {
  const { data } = await sb.from('kisi_kisi').select('*').order('created_at', { ascending: false });
  renderKisiGrid(data || [], 'admin-kisi-list', true);
}

function subscribeAdminKisi() {
  sb.channel('admin-kisi-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kisi_kisi' }, () => loadAdminKisi())
    .subscribe();
}

async function addKisi() {
  const mapel = document.getElementById('kisi-mapel-input').value;
  const judul = document.getElementById('kisi-judul').value.trim();
  const isi = document.getElementById('kisi-isi-input').value.trim();
  const tanggal = document.getElementById('kisi-tanggal').value;

  if (!mapel || !judul || !isi) { showAlert('alert-kisi', 'Mata pelajaran, judul, dan isi wajib diisi.'); return; }

  const { error } = await sb.from('kisi_kisi').insert({
    mata_pelajaran: mapel, judul, isi,
    tanggal_buka: tanggal ? new Date(tanggal).toISOString() : null
  });

  if (error) { showAlert('alert-kisi', 'Gagal menambahkan kisi-kisi.'); return; }

  document.getElementById('kisi-mapel-input').value = '';
  document.getElementById('kisi-judul').value = '';
  document.getElementById('kisi-isi-input').value = '';
  document.getElementById('kisi-tanggal').value = '';
  showAlert('alert-kisi', 'Kisi-kisi berhasil ditambahkan! 🎉', 'success');
  setTimeout(() => document.getElementById('alert-kisi').classList.remove('show'), 3000);
  toast('Kisi-kisi ditambahkan', 'success');
}

async function deleteKisi(id) {
  if (!confirm('Hapus kisi-kisi ini?')) return;
  await sb.from('kisi_kisi').delete().eq('id', id);
  toast('Kisi-kisi dihapus', 'info');
}

// =================== ADMIN TABS ===================
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach((b, i) =>
    b.classList.toggle('active', (tab === 'pendaftar' && i === 0) || (tab === 'kelola-kisi' && i === 1))
  );
  document.getElementById('panel-pendaftar').classList.toggle('active', tab === 'pendaftar');
  document.getElementById('panel-kelola-kisi').classList.toggle('active', tab === 'kelola-kisi');
}

// =================== BOOTSTRAP ===================
(async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    await loadUserAndRoute(session.user);
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) await loadUserAndRoute(session.user);
  });
})();
