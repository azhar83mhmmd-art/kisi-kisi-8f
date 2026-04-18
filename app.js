// ── STATE ──────────────────────────────────────────────────────────────────
let currentUser = null, currentProfile = null, currentMapel = null;
let rtProfiles = null, rtMapel = null, rtBroadcast = null;
let selectedRole = 'siswa';
let seenBroadcasts = JSON.parse(localStorage.getItem('seen_broadcasts') || '[]');

// ── HELPERS ────────────────────────────────────────────────────────────────
const q          = id => document.getElementById(id);
const esc        = s  => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const setLoading = (btn, on) => { if (!btn) return; btn.classList.toggle('btn-loading', on); btn.disabled = on; };
const fmtDate    = iso => iso ? new Date(iso).toLocaleDateString('id-ID',
  { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const isOnline   = lastSeen => {
  if (!lastSeen) return false;
  return (Date.now() - new Date(lastSeen).getTime()) < 65000; // 65s window
};

// ── MARKDOWN ───────────────────────────────────────────────────────────────
function md(text) {
  if (!text) return '';
  return text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\|(.+)\|/g, m => {
      const cells = m.slice(1,-1).split('|').map(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    .replace(/(<tr>[\s\S]*?<\/tr>)+/g, '<table>$&</table>')
    .replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
}

// ── ROUTER ─────────────────────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const p = document.getElementById(id);
  if (p) { p.classList.add('active'); window.scrollTo(0, 0); }
}

// ── TOAST ──────────────────────────────────────────────────────────────────
function showToast(title, msg, type = 'info') {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${icons[type]}</span><div><div class="t-title">${title}</div><div class="t-msg">${msg}</div></div>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 280); }, 4500);
}

// ── LOADING SCREEN ─────────────────────────────────────────────────────────
function showLoader(msg = 'Memuat...') {
  let el = q('app-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-loader';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="loader-inner">
      <div class="loader-brand"><span class="brand-mark" style="width:52px;height:52px;font-size:22px">K</span></div>
      <div class="loader-spinner"></div>
      <div class="loader-msg">${msg}</div>
    </div>`;
  el.style.display = 'flex';
}

function hideLoader() {
  const el = q('app-loader');
  if (el) {
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; }, 400);
  }
}

// ── INIT APP ───────────────────────────────────────────────────────────────
let _initAppForUserId = null; // track which user we already initialized
async function initApp(session) {
  if (!session) { hideLoader(); showPage('page-login'); return; }

  // Skip if we already fully initialized for this exact user (e.g. duplicate SIGNED_IN after OTP)
  if (_initAppForUserId === session.user.id && currentProfile) {
    hideLoader(); return;
  }
  _initAppForUserId = session.user.id;

  showLoader('Menyiapkan akun...');
  currentUser = session.user;

  const isOAuth = session.user.app_metadata?.provider === 'google';
  currentProfile = isOAuth
    ? await ensureProfile(session.user)
    : await getProfile(session.user.id);

  if (!currentProfile) { hideLoader(); _initAppForUserId = null; await logoutUser(); return; }

  // Check ban
  if (currentProfile.ban_type === 'temp' && currentProfile.ban_until) {
    if (new Date(currentProfile.ban_until) > new Date()) {
      hideLoader(); showBannedPage(currentProfile); return;
    }
    // Expired — unban background
    unbanUser(currentProfile.id).then(() => getProfile(currentUser.id).then(p => { if (p) currentProfile = p; }));
  }

  startPresence(); // always fire-and-forget
  hideLoader();
  routeProfile(currentProfile);
  setTimeout(checkAndShowBroadcasts, 1500);
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

function showBannedPage(p) {
  const until = p.ban_until ? fmtDate(p.ban_until) : 'Permanen';
  q('banned-info').innerHTML = `
    <div class="ban-detail">
      <div class="ban-row"><span>Tipe</span><span class="ban-val">${p.ban_type === 'temp' ? '⏱️ Sementara' : '🚫 Permanen'}</span></div>
      <div class="ban-row"><span>Sampai</span><span class="ban-val">${until}</span></div>
      ${p.ban_reason ? `<div class="ban-row"><span>Alasan</span><span class="ban-val">${esc(p.ban_reason)}</span></div>` : ''}
    </div>`;
  showPage('page-banned');
}

// ── BROADCAST POPUP ────────────────────────────────────────────────────────
async function checkAndShowBroadcasts() {
  const { data } = await getBroadcasts();
  if (!data?.length) return;
  const newBC = data.find(b => !seenBroadcasts.includes(b.id));
  if (newBC) showBroadcastModal(newBC);
}

function showBroadcastModal(bc) {
  q('bc-title').textContent = bc.title || 'Pemberitahuan';
  q('bc-body').innerHTML = md(bc.body || '');
  q('bc-time').textContent = fmtDate(bc.created_at);
  q('btn-bc-close').onclick = () => {
    seenBroadcasts.push(bc.id);
    localStorage.setItem('seen_broadcasts', JSON.stringify(seenBroadcasts));
    closeModal('modal-broadcast');
    // Check for more broadcasts
    setTimeout(async () => {
      const { data } = await getBroadcasts();
      const next = data?.find(b => !seenBroadcasts.includes(b.id));
      if (next) showBroadcastModal(next);
    }, 500);
  };
  openModal('modal-broadcast');
}

// ── AUTH TABS ──────────────────────────────────────────────────────────────
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
  const secretWrap = q('secret-wrap');
  if (secretWrap) secretWrap.style.display = role === 'admin' ? 'block' : 'none';
}

// ── LOGIN ──────────────────────────────────────────────────────────────────
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

  // Check ban
  if (res.profile.ban_type === 'temp' && res.profile.ban_until) {
    if (new Date(res.profile.ban_until) > new Date()) {
      showBannedPage(res.profile); return;
    }
  }
  if (res.profile.status === 'rejected' && res.profile.ban_type) {
    showBannedPage(res.profile); return;
  }

  startPresence(); // fire-and-forget
  routeProfile(res.profile);
  setTimeout(checkAndShowBroadcasts, 1500);
}

// ── REGISTER ───────────────────────────────────────────────────────────────
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
      showToast('Kode Salah', 'Kode rahasia admin tidak valid.', 'error'); return;
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

// ── OTP ────────────────────────────────────────────────────────────────────
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
  // Pre-set so initApp skips the duplicate SIGNED_IN that Supabase fires after verifyOtp
  _initAppForUserId = res.user.id;

  if (res.profile?.role === 'admin') {
    showToast('Berhasil!', `Selamat datang, ${res.profile.nama_lengkap}! 🎉`, 'success');
    startPresence();
    initAdmin(); showPage('page-admin');
    setTimeout(checkAndShowBroadcasts, 1500);
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
  showToast('Terkirim', 'OTP baru telah dikirim ke email Anda.', 'info');
}

async function checkStatus() {
  if (!currentUser) return;
  const p = await getProfile(currentUser.id);
  if (!p) return;
  currentProfile = p;
  if (p.status === 'approved') {
    startPresence(); // fire-and-forget
    initDashboard(); showPage('page-dashboard');
    showToast('Disetujui!', 'Selamat, akun Anda disetujui.', 'success');
  } else if (p.status === 'rejected') showPage('page-rejected');
  else showToast('Masih Pending', 'Akun masih diverifikasi admin.', 'warning');
}

// ── DASHBOARD ──────────────────────────────────────────────────────────────
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
  rtBroadcast = subscribeToBroadcasts(async (payload) => {
    const bc = payload.new;
    if (bc && !seenBroadcasts.includes(bc.id) && bc.active) {
      setTimeout(() => showBroadcastModal(bc), 500);
    }
  });
}

async function loadMapel() {
  const grid = q('mapel-grid');
  // Skeleton
  grid.innerHTML = [...Array(6)].map(() =>
    `<div class="mapel-card skel-card">
      <div class="skel" style="width:38px;height:38px;border-radius:10px;margin-bottom:14px"></div>
      <div class="skel" style="width:70%;height:13px;margin-bottom:8px"></div>
      <div class="skel" style="width:45%;height:10px"></div>
    </div>`
  ).join('');

  const { data, error } = await getMapel();
  if (error) { showToast('Error', 'Gagal memuat mapel.', 'error'); return; }
  const avail = (data||[]).filter(m => !m.is_locked).length;
  const totalEl = q('stat-total'); if (totalEl) totalEl.textContent = (data||[]).length;
  const availEl = q('stat-avail'); if (availEl) availEl.textContent = avail;

  grid.innerHTML = (data||[]).map((m, i) =>
    `<div class="mapel-card ${m.is_locked ? 'locked' : ''}"
      onclick="${m.is_locked ? '' : `showDisclaimer('${m.id}','${esc(m.nama)}','${m.icon}')`}"
      style="animation-delay:${i*.06}s;--card-accent:linear-gradient(120deg,${m.color_from},${m.color_to})"
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

// ── DISCLAIMER MODAL ───────────────────────────────────────────────────────
function showDisclaimer(id, nama, icon) {
  q('disc-icon').textContent = icon;
  q('disc-name').textContent = nama;
  q('btn-disc-ok').onclick   = () => { closeModal('modal-disclaimer'); openKisi(id, nama, icon); };
  openModal('modal-disclaimer');
}

// ── KISI-KISI PAGE ─────────────────────────────────────────────────────────
async function openKisi(id, nama, icon) {
  currentMapel = { id, nama, icon };
  document.getElementById('kisi-hero').innerHTML = `
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
          <div class="kisi-row"><span class="tag ${item.tipe}">${item.tipe}</span>
          <span class="kisi-item-title">${esc(item.judul)}</span></div>
          <span class="chevron">▼</span>
        </div>
        <div class="kisi-body">${md(item.konten)}</div>
      </div>`
    ).join('') + `</div>`;
  if (data[0]) setTimeout(() => toggleKisi(data[0].id), 300);
}

function toggleKisi(id) { q(`ki-${id}`)?.classList.toggle('open'); }
function goBack()        { showPage('page-dashboard'); }

// ── ADMIN ──────────────────────────────────────────────────────────────────
function initAdmin() {
  const p = currentProfile;
  if (p) {
    q('admin-name').textContent   = p.nama_lengkap;
    q('admin-avatar').textContent = p.nama_lengkap.charAt(0).toUpperCase();
  }
  loadAdminStats(); adminSection('users');
  rtProfiles = subscribeToProfiles(() => {
    loadAdminStats();
    const cur = document.querySelector('.sidebar-item.active')?.id?.replace('nav-','');
    if (cur === 'users') loadUsers();
    showToast('Update', 'Data pengguna diperbarui.', 'info');
  });
}

function adminSection(sec) {
  const sections = ['users','mapel','soal','broadcast','monitoring','logs'];
  sections.forEach(s => {
    q(`nav-${s}`)?.classList.toggle('active', s === sec);
    const el = q(`admin-${s}`);
    if (el) el.style.display = s === sec ? 'block' : 'none';
  });
  if (sec === 'users')      loadUsers();
  if (sec === 'mapel')      loadAdminMapel();
  if (sec === 'soal')       loadAdminSoal();
  if (sec === 'broadcast')  loadAdminBroadcasts();
  if (sec === 'monitoring') loadMonitoring();
  if (sec === 'logs')       loadAdminLogs();
}

async function loadAdminStats() {
  const { data } = await getAllUsers();
  if (!data) return;
  const counts = data.reduce((a,u) => { a[u.status] = (a[u.status]||0)+1; return a; }, {});
  const online = data.filter(u => isOnline(u.last_seen)).length;
  q('a-total').textContent    = data.length;
  q('a-pending').textContent  = counts.pending   || 0;
  q('a-approved').textContent = counts.approved  || 0;
  q('a-rejected').textContent = counts.rejected  || 0;
  q('a-online').textContent   = online;
  const today = data.filter(u =>
    new Date(u.created_at).toDateString() === new Date().toDateString()
  ).length;
  const el = q('stat-today'); if (el) el.textContent = today;
}

// ── USER TABLE ─────────────────────────────────────────────────────────────
async function loadUsers() {
  const tbody = q('users-tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="td-empty">Memuat data...</td></tr>`;
  const { data, error } = await getAllUsers();
  if (error) { tbody.innerHTML = `<tr><td colspan="7" class="td-empty" style="color:var(--red)">Gagal memuat data.</td></tr>`; return; }
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="7" class="td-empty">Belum ada pengguna.</td></tr>`; return; }

  tbody.innerHTML = data.map(u => {
    const online = isOnline(u.last_seen);
    const isBanned = u.ban_type != null;
    return `
    <tr>
      <td><div class="u-cell">
        <div class="avatar-wrap">
          <div class="avatar" style="width:32px;height:32px">${u.nama_lengkap.charAt(0).toUpperCase()}</div>
          <span class="presence-dot ${online ? 'online' : 'offline'}"></span>
        </div>
        <div><div class="u-name">${esc(u.nama_lengkap)}</div><div class="u-email">${esc(u.email)}</div></div>
      </div></td>
      <td>${u.kelas}</td>
      <td><span class="badge ${u.role==='admin'?'b-admin':'b-siswa'}">${u.role}</span></td>
      <td>
        <span class="badge b-${u.status}">${u.status}</span>
        ${isBanned ? `<span class="badge b-banned" style="margin-left:4px">🚫 ${u.ban_type}</span>` : ''}
      </td>
      <td style="font-size:11px;color:var(--dim)">${online ? '<span style="color:var(--green)">● Online</span>' : (u.last_seen ? fmtDate(u.last_seen) : '—')}</td>
      <td style="color:var(--dim);font-size:11px">${fmtDate(u.created_at)}</td>
      <td>${u.role !== 'admin' ? `<div class="acts">
        ${u.status!=='approved' && !isBanned ? `<button class="btn btn-success btn-sm" onclick="setStatus('${u.id}','approved','${esc(u.nama_lengkap)}')">✓</button>` : ''}
        ${u.status!=='rejected' && !isBanned ? `<button class="btn btn-danger btn-sm" onclick="setStatus('${u.id}','rejected','${esc(u.nama_lengkap)}')">✕</button>` : ''}
        ${!isBanned ? `<button class="btn btn-warn btn-sm" onclick="openBanModal('${u.id}','${esc(u.nama_lengkap)}')">🚫 Ban</button>` : ''}
        ${isBanned ? `<button class="btn btn-success btn-sm" onclick="doUnban('${u.id}','${esc(u.nama_lengkap)}')">🔓 Unban</button>` : ''}
      </div>` : '<span style="color:var(--dim)">—</span>'}</td>
    </tr>`;
  }).join('');
}

async function setStatus(id, status, nama) {
  if (status === 'rejected' && !confirm(`Tolak akun ${nama}?`)) return;
  const res = await updateUserStatus(id, status);
  const labels = { approved:'✅ Diapprove', rejected:'Direject', pending:'Dikembalikan ke pending' };
  const types  = { approved:'success', rejected:'warning', pending:'info' };
  if (res.success) { showToast('Berhasil', `${nama} — ${labels[status]}`, types[status]); loadUsers(); loadAdminStats(); }
  else showToast('Error', res.error, 'error');
}

// ── BAN MODAL ──────────────────────────────────────────────────────────────
let banTargetId = null;
function openBanModal(id, nama) {
  banTargetId = id;
  q('ban-target-name').textContent = nama;
  q('ban-reason-input').value = '';
  q('ban-type-select').value = 'temp';
  openModal('modal-ban');
}

async function confirmBan() {
  const type   = q('ban-type-select').value;
  const reason = q('ban-reason-input').value.trim();
  if (!reason) { showToast('Error', 'Alasan ban wajib diisi.', 'error'); return; }
  const btn = q('btn-ban-confirm');
  setLoading(btn, true);
  const res = await banUser(banTargetId, type, reason);
  setLoading(btn, false);
  if (res.success) {
    showToast('Berhasil', `Pengguna berhasil di-ban (${type}).`, 'warning');
    closeModal('modal-ban');
    loadUsers(); loadAdminStats();
  } else showToast('Error', res.error, 'error');
}

async function doUnban(id, nama) {
  if (!confirm(`Hapus ban untuk ${nama}?`)) return;
  const res = await unbanUser(id);
  if (res.success) { showToast('Berhasil', `${nama} berhasil di-unban.`, 'success'); loadUsers(); loadAdminStats(); }
  else showToast('Error', res.error, 'error');
}

function searchUsers(val) {
  document.querySelectorAll('#users-tbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(val.toLowerCase()) ? '' : 'none';
  });
}

// ── ADMIN MAPEL ────────────────────────────────────────────────────────────
async function loadAdminMapel() {
  const grid = q('admin-mapel-grid');
  const { data } = await getMapel();
  if (!data) return;
  grid.innerHTML = data.map(m => `
    <div class="mapel-mgr-card">
      <div class="mapel-mgr-top">
        <div class="mapel-mgr-name"><span style="font-size:20px">${m.icon}</span><span>${esc(m.nama)}</span></div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-ghost btn-sm" onclick="openEditMapelModal('${m.id}','${esc(m.nama)}','${m.icon}','${m.color_from}','${m.color_to}')">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="doDeleteMapel('${m.id}','${esc(m.nama)}')">🗑️</button>
          <label class="toggle">
            <input type="checkbox" ${!m.is_locked ? 'checked' : ''} onchange="toggleMapel('${m.id}',this.checked)">
            <span class="toggle-track"></span>
          </label>
        </div>
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

function openAddMapelModal() {
  q('mapel-modal-title').textContent = 'Tambah Mata Pelajaran';
  q('mapel-form-id').value = '';
  q('mapel-form-nama').value = '';
  q('mapel-form-icon').value = '📚';
  q('mapel-form-color-from').value = '#4f8ef7';
  q('mapel-form-color-to').value   = '#9b7ef8';
  openModal('modal-mapel');
}

function openEditMapelModal(id, nama, icon, cf, ct) {
  q('mapel-modal-title').textContent = 'Edit Mata Pelajaran';
  q('mapel-form-id').value   = id;
  q('mapel-form-nama').value = nama;
  q('mapel-form-icon').value = icon;
  q('mapel-form-color-from').value = cf;
  q('mapel-form-color-to').value   = ct;
  openModal('modal-mapel');
}

async function saveMapel() {
  const btn  = q('btn-save-mapel');
  const id   = q('mapel-form-id').value;
  const nama = q('mapel-form-nama').value.trim();
  const icon = q('mapel-form-icon').value.trim() || '📚';
  const cf   = q('mapel-form-color-from').value;
  const ct   = q('mapel-form-color-to').value;

  if (!nama) { showToast('Error', 'Nama mapel wajib diisi.', 'error'); return; }
  setLoading(btn, true);
  let res;
  if (id) {
    res = await updateMapel(id, { nama, icon, color_from: cf, color_to: ct });
  } else {
    const { data: existing } = await getMapel();
    const urutan = (existing?.length || 0) + 1;
    res = await createMapel({ nama, icon, color_from: cf, color_to: ct, urutan, is_locked: true });
  }
  setLoading(btn, false);
  if (res.success) {
    showToast('Berhasil', id ? 'Mapel diperbarui.' : 'Mapel ditambahkan.', 'success');
    closeModal('modal-mapel');
    loadAdminMapel();
  } else showToast('Error', res.error, 'error');
}

async function doDeleteMapel(id, nama) {
  if (!confirm(`Hapus mapel "${nama}"? Semua kisi-kisi di dalamnya akan terhapus!`)) return;
  const res = await deleteMapel(id);
  if (res.success) { showToast('Berhasil', `Mapel "${nama}" dihapus.`, 'success'); loadAdminMapel(); }
  else showToast('Error', res.error, 'error');
}

// ── ADMIN SOAL (KISI-KISI) ─────────────────────────────────────────────────
let currentSoalMapelId = null;

async function loadAdminSoal() {
  const { data: mapelList } = await getMapel();
  if (!mapelList?.length) {
    q('admin-soal').innerHTML = `<h2 class="sec-title">Manajemen Soal</h2><div class="empty-box">Belum ada mata pelajaran. Tambah mapel dulu.</div>`;
    return;
  }
  // Rebuild soal section
  q('soal-mapel-select').innerHTML = mapelList.map(m =>
    `<option value="${m.id}">${m.icon} ${esc(m.nama)}</option>`
  ).join('');
  if (!currentSoalMapelId) currentSoalMapelId = mapelList[0].id;
  q('soal-mapel-select').value = currentSoalMapelId;
  loadSoalList();
}

async function loadSoalList() {
  const list = q('soal-list');
  list.innerHTML = `<div class="td-empty">Memuat...</div>`;
  const { data, error } = await getKisiKisi(currentSoalMapelId);
  if (error) { list.innerHTML = `<div class="td-empty" style="color:var(--red)">Gagal memuat.</div>`; return; }
  if (!data?.length) {
    list.innerHTML = `<div class="empty-box">Belum ada soal untuk mapel ini. <span class="link" onclick="openAddSoalModal()">+ Tambah sekarang</span></div>`;
    return;
  }
  list.innerHTML = data.map(item => `
    <div class="soal-card">
      <div class="soal-card-head">
        <div class="soal-card-meta">
          <span class="tag ${item.tipe}">${item.tipe}</span>
          <span class="soal-card-title">${esc(item.judul)}</span>
        </div>
        <div class="soal-card-acts">
          <button class="btn btn-ghost btn-sm" onclick="openEditSoalModal('${item.id}','${esc(item.judul)}','${item.tipe}','${esc(item.konten).replace(/'/g,"&#39;")}')">✏️ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="doDeleteSoal('${item.id}','${esc(item.judul)}')">🗑️</button>
        </div>
      </div>
      <div class="soal-preview">${md(item.konten).replace(/<[^>]+>/g,' ').slice(0,120)}...</div>
    </div>`
  ).join('');
}

function onSoalMapelChange(val) {
  currentSoalMapelId = val;
  loadSoalList();
}

function openAddSoalModal() {
  q('soal-modal-title').textContent = 'Tambah Soal / Materi';
  q('soal-form-id').value = '';
  q('soal-form-judul').value = '';
  q('soal-form-tipe').value = 'materi';
  q('soal-form-konten').value = '';
  openModal('modal-soal');
}

function openEditSoalModal(id, judul, tipe, konten) {
  q('soal-modal-title').textContent = 'Edit Soal / Materi';
  q('soal-form-id').value    = id;
  q('soal-form-judul').value = judul;
  q('soal-form-tipe').value  = tipe;
  q('soal-form-konten').value = konten.replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
  openModal('modal-soal');
}

async function saveSoal() {
  const btn    = q('btn-save-soal');
  const id     = q('soal-form-id').value;
  const judul  = q('soal-form-judul').value.trim();
  const tipe   = q('soal-form-tipe').value;
  const konten = q('soal-form-konten').value.trim();

  if (!judul) { showToast('Error', 'Judul wajib diisi.', 'error'); return; }
  if (!konten) { showToast('Error', 'Konten wajib diisi.', 'error'); return; }

  setLoading(btn, true);
  let res;
  if (id) {
    res = await updateKisiKisi(id, { judul, tipe, konten });
  } else {
    const { data: existing } = await getKisiKisi(currentSoalMapelId);
    const urutan = (existing?.length || 0) + 1;
    res = await createKisiKisi({ mapel_id: currentSoalMapelId, judul, tipe, konten, urutan });
  }
  setLoading(btn, false);
  if (res.success) {
    showToast('Berhasil', id ? 'Soal diperbarui.' : 'Soal ditambahkan.', 'success');
    closeModal('modal-soal');
    loadSoalList();
  } else showToast('Error', res.error, 'error');
}

async function doDeleteSoal(id, judul) {
  if (!confirm(`Hapus "${judul}"?`)) return;
  const res = await deleteKisiKisi(id);
  if (res.success) { showToast('Berhasil', 'Soal dihapus.', 'success'); loadSoalList(); }
  else showToast('Error', res.error, 'error');
}

// ── BROADCAST ──────────────────────────────────────────────────────────────
async function loadAdminBroadcasts() {
  const list = q('broadcast-list');
  list.innerHTML = `<div class="td-empty">Memuat...</div>`;
  const { data, error } = await getBroadcasts();
  if (error) { list.innerHTML = `<div class="td-empty" style="color:var(--red)">Gagal memuat.</div>`; return; }
  if (!data?.length) {
    list.innerHTML = `<div class="empty-box">Belum ada broadcast aktif.</div>`;
    return;
  }
  list.innerHTML = data.map(b => `
    <div class="bc-card">
      <div class="bc-head">
        <div class="bc-title">${esc(b.title)}</div>
        <button class="btn btn-danger btn-sm" onclick="doDeleteBroadcast('${b.id}')">Hapus</button>
      </div>
      <div class="bc-body">${esc(b.body).slice(0,120)}${b.body?.length > 120 ? '...' : ''}</div>
      <div class="bc-meta">${fmtDate(b.created_at)}${b.scheduled_at ? ` · Jadwal: ${fmtDate(b.scheduled_at)}` : ''}</div>
    </div>`).join('');
}

async function sendBroadcast() {
  const btn      = q('btn-send-broadcast');
  const title    = q('bc-form-title').value.trim();
  const body     = q('bc-form-body').value.trim();
  const schedule = q('bc-form-schedule').value;

  if (!title) { showToast('Error', 'Judul wajib diisi.', 'error'); return; }
  if (!body) { showToast('Error', 'Isi pesan wajib diisi.', 'error'); return; }

  setLoading(btn, true);
  const res = await createBroadcast(title, body, schedule || null);
  setLoading(btn, false);

  if (res.success) {
    showToast('Berhasil', 'Broadcast dikirim ke semua pengguna!', 'success');
    q('bc-form-title').value = '';
    q('bc-form-body').value = '';
    q('bc-form-schedule').value = '';
    loadAdminBroadcasts();
  } else showToast('Error', res.error, 'error');
}

async function doDeleteBroadcast(id) {
  if (!confirm('Hapus broadcast ini?')) return;
  const res = await deleteBroadcast(id);
  if (res.success) { showToast('Berhasil', 'Broadcast dihapus.', 'success'); loadAdminBroadcasts(); }
  else showToast('Error', res.error, 'error');
}

// ── MONITORING ─────────────────────────────────────────────────────────────
let monitorInterval = null;
async function loadMonitoring() {
  if (monitorInterval) clearInterval(monitorInterval);
  await refreshMonitoring();
  monitorInterval = setInterval(refreshMonitoring, 30000);
}

async function refreshMonitoring() {
  const wrap = q('monitoring-list');
  const { data } = await getAllUsers();
  if (!data) return;

  const online  = data.filter(u => isOnline(u.last_seen));
  const offline = data.filter(u => !isOnline(u.last_seen) && u.role !== 'admin').slice(0, 20);

  q('monitor-online-count').textContent = online.length;
  q('monitor-total-count').textContent  = data.length;

  const renderUser = (u) => `
    <div class="monitor-row">
      <div class="avatar-wrap" style="flex-shrink:0">
        <div class="avatar" style="width:34px;height:34px">${u.nama_lengkap.charAt(0).toUpperCase()}</div>
        <span class="presence-dot ${isOnline(u.last_seen) ? 'online' : 'offline'}"></span>
      </div>
      <div style="flex:1;min-width:0">
        <div class="u-name">${esc(u.nama_lengkap)}</div>
        <div class="u-email">${esc(u.email)}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--dim)">
        ${isOnline(u.last_seen)
          ? '<span style="color:var(--green);font-weight:600">● Online</span>'
          : (u.last_seen ? `Terakhir: ${fmtDate(u.last_seen)}` : 'Belum pernah')}
      </div>
    </div>`;

  wrap.innerHTML = `
    <div class="monitor-section">
      <div class="monitor-section-title">🟢 Sedang Online (${online.length})</div>
      ${online.length ? online.map(renderUser).join('') : '<div class="td-empty">Tidak ada pengguna online</div>'}
    </div>
    <div class="monitor-section" style="margin-top:20px">
      <div class="monitor-section-title">⚫ Terakhir Aktif</div>
      ${offline.length ? offline.map(renderUser).join('') : '<div class="td-empty">Tidak ada data</div>'}
    </div>`;
}

// ── ACTIVITY LOGS ──────────────────────────────────────────────────────────
async function loadAdminLogs() {
  const list = q('logs-list');
  list.innerHTML = `<div class="td-empty">Memuat log...</div>`;
  const { data, error } = await getAdminLogs();
  if (error) { list.innerHTML = `<div class="td-empty" style="color:var(--red)">Gagal memuat log.</div>`; return; }
  if (!data?.length) { list.innerHTML = `<div class="empty-box">Belum ada log aktivitas.</div>`; return; }

  list.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Detail</th></tr></thead>
    <tbody>${data.map(l => `
      <tr>
        <td style="font-size:11px;color:var(--dim);white-space:nowrap">${fmtDate(l.created_at)}</td>
        <td><div class="u-name">${esc(l.profiles?.nama_lengkap||'System')}</div></td>
        <td><span class="badge b-admin">${esc(l.action)}</span></td>
        <td style="font-size:12px;color:var(--muted)">${esc(l.detail||'—')}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── MODAL ──────────────────────────────────────────────────────────────────
const openModal  = id => q(id)?.classList.add('open');
const closeModal = id => q(id)?.classList.remove('open');
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-bg')) e.target.classList.remove('open');
});

// ── BOOT ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setRole('siswa');
  showLoader('Memuat...');

  // Get session immediately — no need to wait for onAuthStateChange for initial load
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await initApp(session);
  } else {
    hideLoader();
    showPage('page-login');
  }

  // Subscribe to future auth changes (login, logout, token refresh)
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
      stopPresence();
      _initAppForUserId = null;
      currentUser = currentProfile = null;
      hideLoader();
      showPage('page-login');
    } else if (event === 'SIGNED_IN') {
      // Only act if it's a NEW user session (not duplicate from OTP verify or token refresh)
      if (session && _initAppForUserId !== session.user.id) {
        await initApp(session);
      }
    }
  });
});
