// ── STATE ──────────────────────────────────────────────────
let currentUser = null, currentProfile = null, currentMapel = null;
let rtProfiles = null, rtMapel = null;
let selectedRole = 'siswa'; // 'siswa' | 'admin'

// ── HELPERS ───────────────────────────────────────────────
const q          = id => document.getElementById(id);
const esc        = s  => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const setLoading = (btn, on) => { if (!btn) return; btn.classList.toggle('btn-loading', on); btn.disabled = on; };
const fmtDate    = iso => iso ? new Date(iso).toLocaleDateString('id-ID',
  { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

// ── ROUTER ─────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById(id);
  if (p) { p.classList.add('active'); window.scrollTo(0, 0); }
}

// ── TOAST ──────────────────────────────────────────────────
function showToast(title, msg, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${icons[type]}</span><div><div class="t-title">${title}</div><div class="t-msg">${msg}</div></div>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, 4500);
}

// ── MARKDOWN ───────────────────────────────────────────────
function md(text) {
  return text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\|(.+)\|/g, m => {
      const cells = m.slice(1,-1).split('|').map(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>[\s\S]*?<\/tr>)+/g, '<table>$&</table>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
}

// ── INIT APP ───────────────────────────────────────────────
async function initApp(session) {
  if (!session) { showPage('page-login'); return; }
  currentUser = session.user;

  const isOAuth = session.user.app_metadata?.provider === 'google';
  currentProfile = isOAuth
    ? await ensureProfile(session.user)
    : await getProfile(session.user.id);

  if (!currentProfile) { await logoutUser(); return; }

  routeProfile(currentProfile);
}

function routeProfile(p) {
  if (p.role === 'admin') {
    showToast('Selamat Datang', 'Login sebagai Admin ✦', 'success');
    initAdmin(); showPage('page-admin');
  } else if (p.status === 'approved') {
    showToast('Halo!', `Selamat datang, ${p.nama_lengkap}.`, 'success');
    initDashboard(); showPage('page-dashboard');
  } else if (p.status === 'pending') {
    showPage('page-pending');
  } else {
    showPage('page-rejected');
  }
}

// ── AUTH TABS (Login / Register) ───────────────────────────
let authTab = 'login';
function switchTab(tab) {
  authTab = tab;
  q('login-form').style.display    = tab === 'login'    ? 'block' : 'none';
  q('register-form').style.display = tab === 'register' ? 'block' : 'none';
  q('tab-masuk').classList.toggle('active', tab === 'login');
  q('tab-daftar').classList.toggle('active', tab === 'register');
  // Reset role pilihan saat ganti tab
  if (tab === 'register') setRole('siswa');
}

// ── ROLE SELECTOR ──────────────────────────────────────────
function setRole(role) {
  selectedRole = role;
  q('role-siswa').classList.toggle('role-active', role === 'siswa');
  q('role-admin').classList.toggle('role-active', role === 'admin');
  const secretWrap = q('secret-wrap');
  if (secretWrap) secretWrap.style.display = role === 'admin' ? 'block' : 'none';
}

// ── LOGIN ──────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn   = q('btn-login');
  const email = q('login-email').value.trim();
  const pw    = q('login-password').value;
  setLoading(btn, true);
  const res = await loginUser(email, pw);
  setLoading(btn, false);
  if (!res.success) { showToast('Gagal Masuk', res.error, 'error'); return; }
  currentUser = res.user; currentProfile = res.profile;
  routeProfile(res.profile);
}

// ── REGISTER ───────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  const btn   = q('btn-register');
  const nama  = q('reg-nama').value.trim();
  const email = q('reg-email').value.trim();
  const pw    = q('reg-password').value;

  if (pw.length < 6) { showToast('Error', 'Password minimal 6 karakter.', 'error'); return; }

  // Validasi kode admin
  if (selectedRole === 'admin') {
    const secret = q('reg-secret')?.value.trim();
    if (secret !== ADMIN_SECRET_CODE) {
      showToast('Kode Salah', 'Kode rahasia admin tidak valid.', 'error');
      return;
    }
  }

  setLoading(btn, true);
  const res = await initiateRegister(nama, email, pw, '8F', selectedRole);
  setLoading(btn, false);

  if (!res.success) { showToast('Error', res.error, 'error'); return; }

  // Tampilkan halaman OTP
  q('otp-email-display').textContent = email;
  q('otp-role-info').textContent = selectedRole === 'admin' ? 'Admin' : 'Siswa';
  showPage('page-otp');
  startOtpTimer();
}

// ── OTP TIMER ──────────────────────────────────────────────
let otpInterval = null;
function startOtpTimer() {
  let s = 300;
  const el = q('otp-countdown');
  if (otpInterval) clearInterval(otpInterval);
  otpInterval = setInterval(() => {
    s--;
    if (el) el.textContent = `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
    if (s <= 0) {
      clearInterval(otpInterval);
      if (el) el.textContent = 'Kadaluarsa';
      showToast('OTP Kadaluarsa', 'Silakan daftar ulang.', 'warning');
    }
  }, 1000);
}

// ── OTP INPUT ──────────────────────────────────────────────
function otpInput(e, i) {
  e.target.value = e.target.value.replace(/\D/g, '').slice(-1);
  e.target.classList.toggle('on', !!e.target.value);
  if (e.target.value && i < 7) q(`otp-${i+1}`)?.focus();
  if ([...Array(8)].every((_,j) => q(`otp-${j}`)?.value)) {
    setTimeout(submitOTP, 200);
  }
}
function otpKey(e, i) {
  if (e.key === 'Backspace' && !e.target.value && i > 0) q(`otp-${i-1}`)?.focus();
}

// ── SUBMIT OTP ─────────────────────────────────────────────
async function submitOTP() {
  const otp = [...Array(8)].map((_,i) => q(`otp-${i}`)?.value || '').join('');
  if (otp.length < 8) { showToast('Error', 'Isi 8 digit OTP.', 'error'); return; }

  const btn = q('btn-verify-otp');
  setLoading(btn, true);
  const res = await verifyOTPAndRegister(otp);
  setLoading(btn, false);

  if (!res.success) {
    showToast('OTP Gagal', res.error, 'error');
    [...Array(8)].forEach((_,i) => {
      const b = q(`otp-${i}`);
      if (b) { b.value = ''; b.classList.remove('on'); }
    });
    q('otp-0')?.focus();
    return;
  }

  clearInterval(otpInterval);
  currentUser    = res.user;
  currentProfile = res.profile;

  // Admin → langsung masuk Admin Panel tanpa konfirmasi
  if (res.profile?.role === 'admin') {
    showToast('Berhasil!', `Selamat datang, ${res.profile.nama_lengkap}! 🎉`, 'success');
    initAdmin();
    showPage('page-admin');
  } else {
    showToast('Berhasil!', 'Akun dibuat. Menunggu persetujuan admin.', 'success');
    showPage('page-pending');
  }
}

// ── RESEND OTP ─────────────────────────────────────────────
async function handleResendOTP() {
  const res = await resendOTPCode();
  if (!res.success) { showToast('Error', res.error, 'error'); return; }
  [...Array(8)].forEach((_,i) => {
    const b = q(`otp-${i}`);
    if (b) { b.value = ''; b.classList.remove('on'); }
  });
  q('otp-0')?.focus();
  startOtpTimer();
  showToast('Terkirim', 'OTP baru telah dikirim ke email Anda.', 'info');
}

// ── CEK STATUS (Pending Page) ──────────────────────────────
async function checkStatus() {
  if (!currentUser) return;
  const p = await getProfile(currentUser.id);
  if (!p) return;
  currentProfile = p;
  if (p.status === 'approved')  { initDashboard(); showPage('page-dashboard'); showToast('Disetujui!', 'Selamat, akun Anda disetujui.', 'success'); }
  else if (p.status === 'rejected') showPage('page-rejected');
  else showToast('Masih Pending', 'Akun masih diverifikasi admin.', 'warning');
}

// ── DASHBOARD ──────────────────────────────────────────────
async function initDashboard() {
  const p = currentProfile;
  if (p) {
    q('dash-name').textContent   = p.nama_lengkap;
    q('dash-avatar').textContent = p.nama_lengkap.charAt(0).toUpperCase();
    const h = new Date().getHours();
    q('dash-greeting').textContent = h < 12 ? 'Selamat Pagi' : h < 17 ? 'Selamat Siang' : 'Selamat Malam';
  }
  await loadMapel();
  rtMapel = subscribeToMapel(() => loadMapel());
}

async function loadMapel() {
  const grid = q('mapel-grid');
  grid.innerHTML = [...Array(10)].map(() =>
    `<div class="mapel-card"><div class="skel" style="width:34px;height:34px;border-radius:8px;margin-bottom:12px"></div>
     <div class="skel" style="width:75%;height:13px;margin-bottom:8px"></div>
     <div class="skel" style="width:45%;height:10px"></div></div>`
  ).join('');
  const { data, error } = await getMapel();
  if (error) { showToast('Error', 'Gagal memuat mapel.', 'error'); return; }
  const avail = (data||[]).filter(m => !m.is_locked).length;
  const totalEl = q('stat-total'); if (totalEl) totalEl.textContent = (data||[]).length;
  const availEl = q('stat-avail'); if (availEl) availEl.textContent = avail;
  grid.innerHTML = (data||[]).map((m, i) =>
    `<div class="mapel-card ${m.is_locked ? 'locked' : ''}"
      onclick="${m.is_locked ? '' : `showDisclaimer('${m.id}','${esc(m.nama)}','${m.icon}')`}"
      style="animation-delay:${i*.05}s;--card-accent:linear-gradient(90deg,${m.color_from},${m.color_to})"
      title="${m.is_locked ? 'Terkunci' : 'Buka kisi-kisi'}">
      ${m.is_locked ? '<span class="mapel-lock">🔒</span>' : ''}
      <span class="mapel-icon">${m.icon}</span>
      <div class="mapel-name">${m.nama}</div>
      <div class="mapel-status ${m.is_locked ? 'lock' : 'avail'}">
        <span class="mapel-dot"></span>${m.is_locked ? 'Terkunci' : 'Tersedia'}
      </div>
    </div>`
  ).join('');
}

// ── DISCLAIMER MODAL ───────────────────────────────────────
function showDisclaimer(id, nama, icon) {
  q('disc-icon').textContent = icon;
  q('disc-name').textContent = nama;
  q('btn-disc-ok').onclick   = () => { closeModal('modal-disclaimer'); openKisi(id, nama, icon); };
  openModal('modal-disclaimer');
}

// ── KISI-KISI PAGE ─────────────────────────────────────────
async function openKisi(id, nama, icon) {
  currentMapel = { id, nama, icon };
  document.getElementById('kisi-hero').innerHTML = `
    <div class="kisi-back" onclick="goBack()">← Kembali ke Dashboard</div>
    <div class="kisi-hero-card">
      <div class="kisi-hero-top">
        <span class="kisi-big-icon">${icon}</span>
        <div><div class="kisi-title">${nama}</div><div class="kisi-sub">Kisi-kisi Ulangan · Kelas 8F</div></div>
      </div>
    </div>`;
  showPage('page-kisi');
  const list = q('kisi-list');
  list.innerHTML = `<div style="padding:0 24px 24px">
    <div class="skel" style="height:72px;border-radius:14px;margin-bottom:12px"></div>
    <div class="skel" style="height:72px;border-radius:14px"></div></div>`;
  const { data, error } = await getKisiKisi(id);
  if (error || !data?.length) {
    list.innerHTML = `<div class="empty"><div class="e-icon">📭</div><p>Belum ada kisi-kisi untuk mapel ini.</p></div>`;
    return;
  }
  list.innerHTML = `<div style="padding:0 24px 32px">` +
    data.map((item, i) => `
      <div class="kisi-item" id="ki-${item.id}" style="animation-delay:${i*.07}s">
        <div class="kisi-item-hd" onclick="toggleKisi('${item.id}')">
          <div class="kisi-row"><span class="tag ${item.tipe}">${item.tipe}</span>
          <span class="kisi-item-title">${item.judul}</span></div>
          <span class="chevron">▼</span>
        </div>
        <div class="kisi-body">${md(item.konten)}</div>
      </div>`
    ).join('') + `</div>`;
  if (data[0]) setTimeout(() => toggleKisi(data[0].id), 300);
}

function toggleKisi(id) { q(`ki-${id}`)?.classList.toggle('open'); }
function goBack()        { showPage('page-dashboard'); }

// ── ADMIN ──────────────────────────────────────────────────
function initAdmin() {
  const p = currentProfile;
  if (p) {
    q('admin-name').textContent   = p.nama_lengkap;
    q('admin-avatar').textContent = p.nama_lengkap.charAt(0).toUpperCase();
  }
  loadAdminStats(); loadUsers(); adminSection('users');
  rtProfiles = subscribeToProfiles(() => {
    loadAdminStats(); loadUsers();
    showToast('Update', 'Data pengguna diperbarui.', 'info');
  });
}

function adminSection(sec) {
  ['users','mapel','stats'].forEach(s => {
    q(`nav-${s}`)?.classList.toggle('active', s === sec);
    const el = q(`admin-${s}`);
    if (el) el.style.display = s === sec ? 'block' : 'none';
  });
  if (sec === 'users')  loadUsers();
  if (sec === 'mapel')  loadAdminMapel();
  if (sec === 'stats')  loadAdminStats();
}

async function loadAdminStats() {
  const { data } = await getAllUsers();
  if (!data) return;
  const counts = data.reduce((a,u) => { a[u.status] = (a[u.status]||0)+1; return a; }, {});
  q('a-total').textContent    = data.length;
  q('a-pending').textContent  = counts.pending   || 0;
  q('a-approved').textContent = counts.approved  || 0;
  q('a-rejected').textContent = counts.rejected  || 0;
  const today = data.filter(u =>
    new Date(u.created_at).toDateString() === new Date().toDateString()
  ).length;
  const el = q('stat-today'); if (el) el.textContent = today;
}

async function loadUsers() {
  const tbody = q('users-tbody');
  tbody.innerHTML = `<tr><td colspan="6" class="td-empty">Memuat data...</td></tr>`;
  const { data, error } = await getAllUsers();
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="td-empty" style="color:var(--red)">Gagal memuat data.</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="6" class="td-empty">Belum ada pengguna.</td></tr>`; return; }
  tbody.innerHTML = data.map(u => `
    <tr>
      <td><div class="u-cell">
        <div class="avatar" style="width:32px;height:32px">${u.nama_lengkap.charAt(0).toUpperCase()}</div>
        <div><div class="u-name">${esc(u.nama_lengkap)}</div><div class="u-email">${esc(u.email)}</div></div>
      </div></td>
      <td>${u.kelas}</td>
      <td><span class="badge ${u.role==='admin'?'b-admin':'b-siswa'}">${u.role}</span></td>
      <td><span class="badge b-${u.status}">${u.status}</span></td>
      <td style="color:var(--dim);font-size:11px">${fmtDate(u.created_at)}</td>
      <td>${u.role !== 'admin' ? `<div class="acts">
        ${u.status!=='approved' ? `<button class="btn btn-success btn-sm" onclick="setStatus('${u.id}','approved','${esc(u.nama_lengkap)}')">✓</button>` : ''}
        ${u.status!=='rejected' ? `<button class="btn btn-danger btn-sm"  onclick="setStatus('${u.id}','rejected','${esc(u.nama_lengkap)}')">✕</button>` : ''}
        ${u.status!=='pending'  ? `<button class="btn btn-ghost btn-sm"   onclick="setStatus('${u.id}','pending','${esc(u.nama_lengkap)}')">⏳</button>` : ''}
      </div>` : '<span style="color:var(--dim)">—</span>'}</td>
    </tr>`).join('');
}

async function setStatus(id, status, nama) {
  if (status === 'rejected' && !confirm(`Reject akun ${nama}?`)) return;
  const res = await updateUserStatus(id, status);
  const labels = { approved:'✅ Diapprove', rejected:'Direject', pending:'Dikembalikan ke pending' };
  const types  = { approved:'success', rejected:'warning', pending:'info' };
  if (res.success) { showToast('Berhasil', `${nama} — ${labels[status]}`, types[status]); loadUsers(); loadAdminStats(); }
  else showToast('Error', res.error, 'error');
}

async function loadAdminMapel() {
  const grid = q('admin-mapel-grid');
  const { data } = await getMapel();
  if (!data) return;
  grid.innerHTML = data.map(m => `
    <div class="mapel-mgr-card">
      <div class="mapel-mgr-top">
        <div class="mapel-mgr-name"><span>${m.icon}</span><span>${m.nama}</span></div>
        <label class="toggle">
          <input type="checkbox" ${!m.is_locked ? 'checked' : ''} onchange="toggleMapel('${m.id}',this.checked)">
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="mapel-mgr-status">Status: <span style="color:${m.is_locked?'var(--red)':'var(--green)'}">
        ${m.is_locked ? '🔒 Terkunci' : '✅ Tersedia'}</span></div>
    </div>`).join('');
}

async function toggleMapel(id, enabled) {
  const res = await toggleMapelLock(id, !enabled);
  if (res.success) showToast('Berhasil', `Mapel ${enabled ? 'dibuka' : 'dikunci'}.`, 'success');
  else showToast('Error', res.error, 'error');
}

function searchUsers(q_) {
  document.querySelectorAll('#users-tbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q_.toLowerCase()) ? '' : 'none';
  });
}

// ── MODAL ──────────────────────────────────────────────────
const openModal  = id => q(id)?.classList.add('open');
const closeModal = id => q(id)?.classList.remove('open');
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) e.target.classList.remove('open');
});

// ── BOOT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Init role selector on load
  setRole('siswa');

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      currentUser = currentProfile = null;
      showPage('page-login');
    } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      await initApp(session);
    }
  });
});
