// ── STATE ────────────────────────────────────────────────────
let currentUser = null, currentProfile = null, currentMapel = null;
let rtProfiles = null, rtMapel = null, rtKisi = null;
let selectedRole = 'siswa';
let allUsers = [];
let editingMapelId = null;
let editingKisiId = null;
let activeAdminMapelId = null;

// ── HELPERS ──────────────────────────────────────────────────
const q       = id => document.getElementById(id);
const esc     = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('id-ID',
  { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

function setLoading(btn, on) {
  if (!btn) return;
  btn.classList.toggle('btn-loading', on);
  btn.disabled = on;
}

// ── LOADING SCREEN ───────────────────────────────────────────
function showAppLoading(msg = 'Memuat...') {
  const el = q('app-loading');
  if (el) {
    el.style.display = 'flex';
    const t = el.querySelector('.loading-text');
    if (t) t.textContent = msg;
  }
}

function hideAppLoading() {
  const el = q('app-loading');
  if (el) {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; }, 300);
  }
}

// ── ROUTER ───────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = '';
  });
  const p = q(id);
  if (p) {
    p.classList.add('active');
    window.scrollTo(0, 0);
  }
}

// ── TOAST ────────────────────────────────────────────────────
function showToast(title, msg, type = 'info') {
  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${icons[type]||'ℹ️'}</span>
    <div><div class="t-title">${esc(title)}</div><div class="t-msg">${esc(msg)}</div></div>`;
  const tc = q('toast-container');
  if (tc) tc.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, 4500);
}

// ── MARKDOWN ─────────────────────────────────────────────────
function md(text) {
  if (!text) return '';
  return text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>')
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    .replace(/\|(.+)\|/g, m => {
      const cells = m.slice(1,-1).split('|').map(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>[\s\S]*?<\/tr>)+/g, '<table>$&</table>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// ── INIT APP ─────────────────────────────────────────────────
async function initApp(session) {
  if (!session) {
    hideAppLoading();
    showPage('page-login');
    return;
  }
  currentUser = session.user;

  try {
    const isOAuth = session.user.app_metadata?.provider === 'google';
    currentProfile = isOAuth
      ? await ensureProfile(session.user)
      : await getProfile(session.user.id);

    if (!currentProfile) {
      hideAppLoading();
      await logoutUser();
      return;
    }

    routeProfile(currentProfile);
  } catch (e) {
    console.error('initApp error:', e);
    hideAppLoading();
    showPage('page-login');
  }
}

function routeProfile(p) {
  hideAppLoading();
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

// ── AUTH TABS ────────────────────────────────────────────────
let authTab = 'login';
function switchTab(tab) {
  authTab = tab;
  q('login-form').style.display    = tab === 'login'    ? 'block' : 'none';
  q('register-form').style.display = tab === 'register' ? 'block' : 'none';
  q('tab-masuk').classList.toggle('active', tab === 'login');
  q('tab-daftar').classList.toggle('active', tab === 'register');
  if (tab === 'register') setRole('siswa');
}

function setRole(role) {
  selectedRole = role;
  q('role-siswa').classList.toggle('role-active', role === 'siswa');
  q('role-admin').classList.toggle('role-active', role === 'admin');
  const sw = q('secret-wrap');
  if (sw) sw.style.display = role === 'admin' ? 'block' : 'none';
}

// ── LOGIN ─────────────────────────────────────────────────────
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
  showAppLoading('Memuat profil...');
  routeProfile(res.profile);
}

// ── REGISTER ─────────────────────────────────────────────────
async function handleRegister(e) {
  e.preventDefault();
  const btn   = q('btn-register');
  const nama  = q('reg-nama').value.trim();
  const email = q('reg-email').value.trim();
  const pw    = q('reg-password').value;

  if (pw.length < 6) { showToast('Error', 'Password minimal 6 karakter.', 'error'); return; }

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

  q('otp-email-display').textContent = email;
  q('otp-role-info').textContent = selectedRole === 'admin' ? 'Admin' : 'Siswa';
  showPage('page-otp');
  startOtpTimer();
}

// ── OTP TIMER ────────────────────────────────────────────────
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

  if (res.profile?.role === 'admin') {
    showToast('Berhasil!', `Selamat datang, ${res.profile.nama_lengkap}! 🎉`, 'success');
    initAdmin(); showPage('page-admin');
  } else {
    showToast('Berhasil!', 'Akun dibuat. Menunggu persetujuan admin.', 'success');
    showPage('page-pending');
  }
}

async function handleResendOTP() {
  const res = await resendOTPCode();
  if (!res.success) { showToast('Error', res.error, 'error'); return; }
  [...Array(8)].forEach((_,i) => {
    const b = q(`otp-${i}`);
    if (b) { b.value = ''; b.classList.remove('on'); }
  });
  q('otp-0')?.focus();
  startOtpTimer();
  showToast('Terkirim', 'OTP baru dikirim ke email Anda.', 'info');
}

async function checkStatus() {
  if (!currentUser) return;
  const p = await getProfile(currentUser.id);
  if (!p) return;
  currentProfile = p;
  if (p.status === 'approved')  { initDashboard(); showPage('page-dashboard'); showToast('Disetujui!', 'Akun Anda disetujui.', 'success'); }
  else if (p.status === 'rejected') showPage('page-rejected');
  else showToast('Masih Pending', 'Akun masih diverifikasi admin.', 'warning');
}

// ── DASHBOARD ────────────────────────────────────────────────
async function initDashboard() {
  const p = currentProfile;
  if (p) {
    q('dash-name').textContent   = p.nama_lengkap;
    q('dash-avatar').textContent = p.nama_lengkap.charAt(0).toUpperCase();
    const h = new Date().getHours();
    q('dash-greeting').textContent = h < 12 ? 'Selamat Pagi' : h < 17 ? 'Selamat Siang' : 'Selamat Malam';
  }
  await loadMapel();
  if (rtMapel) rtMapel.unsubscribe();
  rtMapel = subscribeToMapel(() => loadMapel());
}

async function loadMapel() {
  const grid = q('mapel-grid');
  if (!grid) return;
  grid.innerHTML = [...Array(6)].map(() =>
    `<div class="mapel-card skeleton-card">
       <div class="skel" style="width:36px;height:36px;border-radius:10px;margin-bottom:14px"></div>
       <div class="skel" style="width:80%;height:14px;margin-bottom:8px"></div>
       <div class="skel" style="width:50%;height:11px"></div>
     </div>`
  ).join('');

  const { data, error } = await getMapel();
  if (error) { showToast('Error', 'Gagal memuat mapel.', 'error'); return; }
  const avail = (data||[]).filter(m => !m.is_locked).length;

  const te = q('stat-total'); if (te) te.textContent = (data||[]).length;
  const ae = q('stat-avail'); if (ae) ae.textContent = avail;

  grid.innerHTML = (data||[]).length === 0
    ? `<div class="empty-full"><div class="e-icon">📭</div><p>Belum ada mata pelajaran.</p></div>`
    : (data||[]).map((m, i) =>
    `<div class="mapel-card ${m.is_locked ? 'locked' : ''}"
      onclick="${m.is_locked ? '' : `showDisclaimer('${m.id}','${esc(m.nama)}','${m.icon}')`}"
      style="animation-delay:${i*.05}s;--card-accent:linear-gradient(135deg,${m.color_from},${m.color_to})"
      title="${m.is_locked ? 'Terkunci' : 'Buka kisi-kisi'}">
      ${m.is_locked ? '<span class="mapel-lock">🔒</span>' : ''}
      <span class="mapel-icon">${m.icon}</span>
      <div class="mapel-name">${esc(m.nama)}</div>
      <div class="mapel-status ${m.is_locked ? 'lock' : 'avail'}">
        <span class="mapel-dot"></span>${m.is_locked ? 'Terkunci' : 'Tersedia'}
      </div>
    </div>`
  ).join('');
}

// ── DISCLAIMER MODAL ─────────────────────────────────────────
function showDisclaimer(id, nama, icon) {
  q('disc-icon').textContent = icon;
  q('disc-name').textContent = nama;
  q('btn-disc-ok').onclick   = () => { closeModal('modal-disclaimer'); openKisi(id, nama, icon); };
  openModal('modal-disclaimer');
}

// ── KISI-KISI PAGE ───────────────────────────────────────────
async function openKisi(id, nama, icon) {
  currentMapel = { id, nama, icon };
  q('kisi-hero').innerHTML = `
    <div class="kisi-back" onclick="goBack()">← Kembali ke Dashboard</div>
    <div class="kisi-hero-card">
      <div class="kisi-hero-top">
        <span class="kisi-big-icon">${icon}</span>
        <div><div class="kisi-title">${esc(nama)}</div><div class="kisi-sub">Kisi-kisi Ulangan · Kelas 8F</div></div>
      </div>
    </div>`;
  showPage('page-kisi');

  const list = q('kisi-list');
  list.innerHTML = `<div style="padding:0 24px 24px">
    ${[...Array(3)].map(() => `<div class="skel" style="height:68px;border-radius:14px;margin-bottom:12px"></div>`).join('')}
  </div>`;

  const { data, error } = await getKisiKisi(id);
  if (error || !data?.length) {
    list.innerHTML = `<div class="empty"><div class="e-icon">📭</div><p>Belum ada kisi-kisi untuk mapel ini.</p></div>`;
    return;
  }
  list.innerHTML = `<div style="padding:0 24px 32px">` +
    data.map((item, i) => `
      <div class="kisi-item" id="ki-${item.id}" style="animation-delay:${i*.07}s">
        <div class="kisi-item-hd" onclick="toggleKisi('${item.id}')">
          <div class="kisi-row">
            <span class="tag ${item.tipe}">${item.tipe}</span>
            <span class="kisi-item-title">${esc(item.judul)}</span>
          </div>
          <span class="chevron">▼</span>
        </div>
        <div class="kisi-body"><div class="kisi-body-inner">${md(item.konten)}</div></div>
      </div>`
    ).join('') + `</div>`;

  if (data[0]) setTimeout(() => toggleKisi(data[0].id), 300);
}

function toggleKisi(id) { q(`ki-${id}`)?.classList.toggle('open'); }
function goBack()        { showPage('page-dashboard'); }

// ── ADMIN INIT ───────────────────────────────────────────────
function initAdmin() {
  const p = currentProfile;
  if (p) {
    q('admin-name').textContent   = p.nama_lengkap;
    q('admin-avatar').textContent = p.nama_lengkap.charAt(0).toUpperCase();
  }
  loadAdminStats(); loadUsers(); adminSection('users');
  if (rtProfiles) rtProfiles.unsubscribe();
  rtProfiles = subscribeToProfiles(() => {
    loadAdminStats(); loadUsers();
    showToast('Update', 'Data pengguna diperbarui.', 'info');
  });
}

function adminSection(sec) {
  ['users','mapel','soal','stats'].forEach(s => {
    // Mobile tabs
    const tab = q(`nav-${s}`);
    if (tab) tab.classList.toggle('active', s === sec);
    // Desktop sidebar items (snav- prefix)
    const snav = q(`snav-${s}`);
    if (snav) snav.classList.toggle('active', s === sec);
    // Content panels
    const el = q(`admin-${s}`);
    if (el) el.style.display = s === sec ? 'block' : 'none';
  });
  if (sec === 'users')  loadUsers();
  if (sec === 'mapel')  loadAdminMapel();
  if (sec === 'soal')   loadAdminSoalPage();
  if (sec === 'stats')  loadAdminStats();
}

// ── ADMIN USERS ──────────────────────────────────────────────
async function loadAdminStats() {
  const { data } = await getAllUsers();
  if (!data) return;
  allUsers = data;
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
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="td-empty"><div class="skel" style="height:16px;width:60%;margin:0 auto"></div></td></tr>`;
  const { data, error } = await getAllUsers();
  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="td-empty" style="color:var(--red)">Gagal memuat data.</td></tr>`; return; }
  allUsers = data || [];
  renderUsersTable(allUsers);
}

function renderUsersTable(data) {
  const tbody = q('users-tbody');
  if (!tbody) return;
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="6" class="td-empty">Belum ada pengguna.</td></tr>`; return; }
  tbody.innerHTML = data.map(u => `
    <tr>
      <td><div class="u-cell">
        <div class="avatar" style="width:32px;height:32px;font-size:11px">${u.nama_lengkap.charAt(0).toUpperCase()}</div>
        <div><div class="u-name">${esc(u.nama_lengkap)}</div><div class="u-email">${esc(u.email)}</div></div>
      </div></td>
      <td>${esc(u.kelas)}</td>
      <td><span class="badge ${u.role==='admin'?'b-admin':'b-siswa'}">${u.role}</span></td>
      <td><span class="badge b-${u.status}">${u.status}</span></td>
      <td class="td-date">${fmtDate(u.created_at)}</td>
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

function searchUsers(q_) {
  const filtered = allUsers.filter(u =>
    (u.nama_lengkap + u.email + u.status + u.role).toLowerCase().includes(q_.toLowerCase())
  );
  renderUsersTable(filtered);
}

// ── ADMIN MAPEL ──────────────────────────────────────────────
async function loadAdminMapel() {
  const grid = q('admin-mapel-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="skel" style="height:90px;border-radius:12px"></div>`.repeat(4);

  const { data } = await getMapel();
  if (!data) return;

  grid.innerHTML = data.length === 0
    ? `<div class="empty-full" style="grid-column:1/-1"><div class="e-icon">📭</div><p>Belum ada mata pelajaran. Tambah dulu!</p></div>`
    : data.map(m => `
    <div class="mapel-mgr-card">
      <div class="mapel-mgr-top">
        <div class="mapel-mgr-info">
          <span class="mapel-mgr-icon">${m.icon}</span>
          <div>
            <div class="mapel-mgr-name">${esc(m.nama)}</div>
            <div class="mapel-mgr-status">Status: <span style="color:${m.is_locked?'var(--red)':'var(--green)'}">
              ${m.is_locked ? '🔒 Terkunci' : '✅ Tersedia'}</span></div>
          </div>
        </div>
        <label class="toggle">
          <input type="checkbox" ${!m.is_locked ? 'checked' : ''} onchange="toggleMapel('${m.id}',this.checked)">
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="mapel-mgr-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditMapel('${m.id}','${esc(m.nama)}','${m.icon}','${m.color_from}','${m.color_to}',${m.urutan})">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="openSoalForMapel('${m.id}','${esc(m.nama)}')">📝 Soal</button>
        <button class="btn btn-danger btn-sm" onclick="deleteMapelConfirm('${m.id}','${esc(m.nama)}')">🗑️ Hapus</button>
      </div>
    </div>`).join('');
}

async function toggleMapel(id, enabled) {
  const res = await toggleMapelLock(id, !enabled);
  if (res.success) { showToast('Berhasil', `Mapel ${enabled ? 'dibuka' : 'dikunci'}.`, 'success'); loadAdminMapel(); }
  else showToast('Error', res.error, 'error');
}

// ── MAPEL MODAL ───────────────────────────────────────────────
function openAddMapel() {
  editingMapelId = null;
  q('mapel-modal-title').textContent = 'Tambah Mata Pelajaran';
  q('mapel-form-nama').value  = '';
  q('mapel-form-icon').value  = '📚';
  q('mapel-form-from').value  = '#4f8ef7';
  q('mapel-form-to').value    = '#9b7ef8';
  q('mapel-form-urutan').value= '0';
  openModal('modal-mapel');
}

function openEditMapel(id, nama, icon, from_, to_, urutan) {
  editingMapelId = id;
  q('mapel-modal-title').textContent = 'Edit Mata Pelajaran';
  q('mapel-form-nama').value   = nama;
  q('mapel-form-icon').value   = icon;
  q('mapel-form-from').value   = from_;
  q('mapel-form-to').value     = to_;
  q('mapel-form-urutan').value = urutan;
  openModal('modal-mapel');
}

async function saveMapel() {
  const nama   = q('mapel-form-nama').value.trim();
  const icon   = q('mapel-form-icon').value.trim() || '📚';
  const from_  = q('mapel-form-from').value;
  const to_    = q('mapel-form-to').value;
  const urutan = parseInt(q('mapel-form-urutan').value) || 0;

  if (!nama) { showToast('Error', 'Nama mapel wajib diisi.', 'error'); return; }

  const btn = q('btn-save-mapel');
  setLoading(btn, true);

  const payload = { nama, icon, color_from: from_, color_to: to_, urutan };
  const res = editingMapelId
    ? await updateMapel(editingMapelId, payload)
    : await createMapel({ ...payload, is_locked: true });

  setLoading(btn, false);

  if (res.success) {
    showToast('Berhasil', editingMapelId ? 'Mapel diperbarui.' : 'Mapel ditambahkan.', 'success');
    closeModal('modal-mapel');
    loadAdminMapel();
  } else {
    showToast('Error', res.error || 'Gagal menyimpan.', 'error');
  }
}

async function deleteMapelConfirm(id, nama) {
  if (!confirm(`Hapus mapel "${nama}"? Semua kisi-kisi di dalamnya juga akan terhapus.`)) return;
  const res = await deleteMapel(id);
  if (res.success) { showToast('Dihapus', `Mapel "${nama}" dihapus.`, 'warning'); loadAdminMapel(); }
  else showToast('Error', res.error, 'error');
}

// ── ADMIN SOAL ────────────────────────────────────────────────
async function loadAdminSoalPage() {
  // Load mapel list into selector
  const sel = q('soal-mapel-select');
  if (!sel) return;
  const { data } = await getMapel();
  if (!data?.length) {
    q('admin-soal').innerHTML = `<h2 class="sec-title">Manajemen Soal / Kisi-kisi</h2><div class="empty-full"><div class="e-icon">📚</div><p>Tambah mata pelajaran terlebih dahulu.</p></div>`;
    return;
  }
  sel.innerHTML = `<option value="">-- Pilih Mata Pelajaran --</option>` +
    data.map(m => `<option value="${m.id}" data-name="${esc(m.nama)}">${m.icon} ${esc(m.nama)}</option>`).join('');

  if (activeAdminMapelId) {
    sel.value = activeAdminMapelId;
    loadKisiAdmin(activeAdminMapelId);
  }
}

function onSoalMapelChange() {
  const sel  = q('soal-mapel-select');
  const id   = sel.value;
  activeAdminMapelId = id;
  if (id) loadKisiAdmin(id);
  else q('kisi-admin-list').innerHTML = `<div class="empty-hint">Pilih mata pelajaran di atas.</div>`;
}

function openSoalForMapel(mapelId, mapelNama) {
  activeAdminMapelId = mapelId;
  adminSection('soal');
}

async function loadKisiAdmin(mapelId) {
  const list = q('kisi-admin-list');
  if (!list) return;
  list.innerHTML = [...Array(3)].map(() => `<div class="skel" style="height:68px;border-radius:12px;margin-bottom:10px"></div>`).join('');

  const { data, error } = await getKisiKisi(mapelId);

  if (error) { list.innerHTML = `<div class="empty-full" style="color:var(--red)">Gagal memuat data.</div>`; return; }
  if (!data?.length) {
    list.innerHTML = `<div class="empty-full"><div class="e-icon">📝</div><p>Belum ada soal/kisi-kisi untuk mapel ini.</p></div>`;
    return;
  }

  list.innerHTML = data.map((item, i) => `
    <div class="kisi-admin-item" style="animation-delay:${i*.04}s">
      <div class="kisi-admin-hd">
        <div class="kisi-admin-left">
          <span class="tag ${item.tipe}">${item.tipe}</span>
          <span class="kisi-admin-title">${esc(item.judul)}</span>
        </div>
        <div class="kisi-admin-acts">
          <button class="btn btn-ghost btn-sm" onclick="openEditKisi('${item.id}','${esc(item.judul)}','${item.tipe}',${item.urutan},\`${item.konten.replace(/`/g,'\\`')}\`)">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="deleteKisiConfirm('${item.id}','${esc(item.judul)}')">🗑️</button>
        </div>
      </div>
      <div class="kisi-admin-preview">${esc(item.konten.substring(0, 80))}${item.konten.length > 80 ? '...' : ''}</div>
    </div>`).join('');
}

// ── KISI MODAL ────────────────────────────────────────────────
function openAddKisi() {
  const mapelId = activeAdminMapelId || q('soal-mapel-select')?.value;
  if (!mapelId) { showToast('Pilih Mapel', 'Pilih mata pelajaran terlebih dahulu.', 'warning'); return; }
  editingKisiId = null;
  q('kisi-modal-title').textContent = 'Tambah Soal / Kisi-kisi';
  q('kisi-form-judul').value  = '';
  q('kisi-form-tipe').value   = 'materi';
  q('kisi-form-urutan').value = '0';
  q('kisi-form-konten').value = '';
  openModal('modal-kisi');
}

function openEditKisi(id, judul, tipe, urutan, konten) {
  editingKisiId = id;
  q('kisi-modal-title').textContent = 'Edit Soal / Kisi-kisi';
  q('kisi-form-judul').value  = judul;
  q('kisi-form-tipe').value   = tipe;
  q('kisi-form-urutan').value = urutan;
  q('kisi-form-konten').value = konten;
  openModal('modal-kisi');
}

async function saveKisi() {
  const mapelId = activeAdminMapelId || q('soal-mapel-select')?.value;
  const judul   = q('kisi-form-judul').value.trim();
  const tipe    = q('kisi-form-tipe').value;
  const urutan  = parseInt(q('kisi-form-urutan').value) || 0;
  const konten  = q('kisi-form-konten').value.trim();

  if (!judul)  { showToast('Error', 'Judul wajib diisi.', 'error'); return; }
  if (!konten) { showToast('Error', 'Konten wajib diisi.', 'error'); return; }

  const btn = q('btn-save-kisi');
  setLoading(btn, true);

  const payload = { judul, tipe, urutan, konten };
  const res = editingKisiId
    ? await updateKisiKisi(editingKisiId, payload)
    : await createKisiKisi({ ...payload, mapel_id: mapelId });

  setLoading(btn, false);

  if (res.success) {
    showToast('Berhasil', editingKisiId ? 'Soal diperbarui.' : 'Soal ditambahkan.', 'success');
    closeModal('modal-kisi');
    if (mapelId) loadKisiAdmin(mapelId);
  } else {
    showToast('Error', res.error || 'Gagal menyimpan.', 'error');
  }
}

async function deleteKisiConfirm(id, judul) {
  if (!confirm(`Hapus soal "${judul}"?`)) return;
  const res = await deleteKisiKisi(id);
  const mapelId = activeAdminMapelId || q('soal-mapel-select')?.value;
  if (res.success) { showToast('Dihapus', 'Soal dihapus.', 'warning'); if (mapelId) loadKisiAdmin(mapelId); }
  else showToast('Error', res.error, 'error');
}

// ── MODAL ──────────────────────────────────────────────────────
const openModal  = id => { const el = q(id); if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; } };
const closeModal = id => { const el = q(id); if (el) { el.classList.remove('open'); document.body.style.overflow = ''; } };
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) {
    e.target.classList.remove('open');
    document.body.style.overflow = '';
  }
});

// ── BOOT ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setRole('siswa');
  showAppLoading('Memeriksa sesi...');

  // Safety timeout – jika auth tidak merespons dalam 8 detik, tampilkan login
  const safetyTimeout = setTimeout(() => {
    hideAppLoading();
    if (!currentUser) showPage('page-login');
  }, 8000);

  sb.auth.onAuthStateChange(async (event, session) => {
    clearTimeout(safetyTimeout);

    if (event === 'SIGNED_OUT' || !session) {
      currentUser = currentProfile = null;
      hideAppLoading();
      showPage('page-login');
    } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      showAppLoading('Memuat profil...');
      await initApp(session);
    }
  });
});
