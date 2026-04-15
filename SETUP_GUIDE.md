# 🛠️ Setup Guide — KisiKisi 8F Private

## 1. Buat Project di Supabase
Daftar/login di https://supabase.com → New Project

---

## 2. Jalankan SQL Berikut di Supabase SQL Editor

```sql
-- EXTENSION
create extension if not exists "uuid-ossp";

-- TABLE USERS
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  nama text,
  email text unique,
  password text,
  kelas text,
  kode_input text,
  status text default 'pending',
  role text default 'siswa',
  created_at timestamp default now()
);

-- TABLE KISI_KISI
create table if not exists kisi_kisi (
  id uuid primary key default uuid_generate_v4(),
  mata_pelajaran text,
  judul text,
  isi text,
  tanggal_buka timestamp,
  created_at timestamp default now()
);

-- REALTIME
alter publication supabase_realtime add table users;
alter publication supabase_realtime add table kisi_kisi;

-- ROW LEVEL SECURITY (nonaktifkan sementara untuk testing)
alter table users enable row level security;
alter table kisi_kisi enable row level security;

-- POLICY: allow all (sesuaikan di production)
create policy "allow_all_users" on users for all using (true) with check (true);
create policy "allow_all_kisi" on kisi_kisi for all using (true) with check (true);

-- INSERT ADMIN DEFAULT
-- Lakukan ini SETELAH mendaftar manual via website dengan email kenzstrx@gmail.com
-- UPDATE users SET role='admin', status='approved' WHERE email='kenzstrx@gmail.com';
```

---

## 3. Setup EmailJS

1. Daftar di https://www.emailjs.com
2. Buat **Email Service** (Gmail, dll)
3. Buat **3 Email Templates**:

### Template: Approved
- Template ID: simpan sebagai `EMAILJS_TEMPLATE_APPROVED`
- Subject: `Pemberitahuan Persetujuan Akun – KisiKisi 8F Private`
- Body:
```
Halo {{nama}},

Terima kasih telah melakukan pendaftaran pada platform KisiKisi 8F Private.

Dengan ini kami informasikan bahwa akun Anda telah berhasil diverifikasi dan disetujui oleh admin. Anda kini dapat mengakses seluruh fitur yang tersedia, termasuk kisi-kisi ulangan.

Silakan login menggunakan email dan kata sandi yang telah Anda daftarkan.

Apabila mengalami kendala atau membutuhkan bantuan lebih lanjut, silakan menghubungi admin.

Hormat,
Kenz
```

### Template: Rejected
- Template ID: simpan sebagai `EMAILJS_TEMPLATE_REJECTED`
- Subject: `Pemberitahuan Hasil Verifikasi Akun – KisiKisi 8F Private`

### Template: Pending
- Template ID: simpan sebagai `EMAILJS_TEMPLATE_PENDING`
- Subject: `Konfirmasi Pendaftaran – KisiKisi 8F Private`

> **Catatan**: Pastikan semua template memiliki variabel `{{nama}}` dan `{{to_email}}`

---

## 4. Isi Konfigurasi di kisikisi8f.html

Buka file HTML, cari bagian `// =================== CONFIG ===================` dan ganti:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const EMAILJS_SERVICE_ID = 'YOUR_SERVICE_ID';
const EMAILJS_TEMPLATE_APPROVED = 'YOUR_TEMPLATE_APPROVED';
const EMAILJS_TEMPLATE_REJECTED = 'YOUR_TEMPLATE_REJECTED';
const EMAILJS_TEMPLATE_PENDING = 'YOUR_TEMPLATE_PENDING';
const EMAILJS_PUBLIC_KEY = 'YOUR_PUBLIC_KEY';
```

Kredensial Supabase: **Project Settings → API**
Kredensial EmailJS: **Dashboard EmailJS → Account**

---

## 5. Setup Admin

1. Buka website → Register dengan email `kenzstrx@gmail.com` password `qwerty`
2. Masuk ke **Supabase SQL Editor** dan jalankan:
```sql
UPDATE users SET role='admin', status='approved' WHERE email='kenzstrx@gmail.com';
```
3. Login → otomatis masuk ke Admin Dashboard

---

## 6. Deploy

Opsi mudah:
- **Netlify Drop**: drag & drop file HTML ke https://app.netlify.com/drop
- **GitHub Pages**: upload ke repo → enable Pages
- **Vercel**: upload file ke vercel.com

---

## 7. Alur Penggunaan

```
Siswa daftar → status: pending
Admin lihat di dashboard → klik Setujui/Tolak → email otomatis terkirim
Siswa login → jika approved → akses kisi-kisi
Admin tambah kisi-kisi → realtime muncul di siswa
Kisi-kisi dengan tanggal buka → tampil blur + countdown
Saat waktu tiba → otomatis terbuka tanpa refresh
```
