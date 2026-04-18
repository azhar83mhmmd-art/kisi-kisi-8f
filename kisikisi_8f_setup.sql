-- ============================================================
--  KisiKisi 8F — Complete SQL Setup v2
--  Jalankan SEKALI di Supabase → SQL Editor → New Query
--  Update: OTP via Supabase built-in, admin daftar mandiri
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
--  TABLES
-- ============================================================

-- Profil pengguna (siswa & admin)
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nama_lengkap TEXT        NOT NULL,
  email        TEXT        NOT NULL UNIQUE,
  kelas        TEXT        NOT NULL DEFAULT '8F',
  role         TEXT        NOT NULL DEFAULT 'siswa'   CHECK (role   IN ('siswa','admin')),
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Mata pelajaran
CREATE TABLE IF NOT EXISTS public.mapel (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  nama       TEXT        NOT NULL,
  icon       TEXT        NOT NULL DEFAULT '📚',
  deskripsi  TEXT,
  is_locked  BOOLEAN     NOT NULL DEFAULT TRUE,
  unlock_at  TIMESTAMPTZ,
  color_from TEXT        NOT NULL DEFAULT '#4f8ef7',
  color_to   TEXT        NOT NULL DEFAULT '#9b7ef8',
  urutan     INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kisi-kisi per mapel
CREATE TABLE IF NOT EXISTS public.kisi_kisi (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapel_id   UUID        NOT NULL REFERENCES public.mapel(id) ON DELETE CASCADE,
  judul      TEXT        NOT NULL,
  konten     TEXT        NOT NULL,
  tipe       TEXT        NOT NULL DEFAULT 'materi' CHECK (tipe IN ('materi','soal','catatan')),
  urutan     INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log aktivitas
CREATE TABLE IF NOT EXISTS public.activity_log (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
--  TRIGGERS — auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at  ON public.profiles;
DROP TRIGGER IF EXISTS trg_kisi_kisi_updated_at ON public.kisi_kisi;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_kisi_kisi_updated_at
  BEFORE UPDATE ON public.kisi_kisi
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
--  TRIGGER — buat profil otomatis saat user baru mendaftar
--  (dipakai saat OTP verified via Supabase auth.signInWithOtp)
--  Profil awal dibuat dengan role/status default;
--  app.js akan UPDATE setelah verifikasi selesai.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nama_lengkap, email, kelas, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nama_lengkap', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'kelas', '8F'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'siswa'),
    'pending'   -- selalu pending dulu; app.js update ke approved jika admin
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapel        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kisi_kisi    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Hapus policy lama agar tidak duplikat saat re-run
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('profiles','mapel','kisi_kisi','activity_log')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── profiles ──────────────────────────────────────────────

-- Helper function: cek apakah user adalah admin (tanpa rekursi)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- Setiap user bisa baca profil sendiri
CREATE POLICY "profiles: baca milik sendiri"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Admin bisa baca semua profil
CREATE POLICY "profiles: admin baca semua"
  ON public.profiles FOR SELECT
  USING (public.is_admin());

-- User baru bisa insert profil milik sendiri (dipanggil app.js)
CREATE POLICY "profiles: insert milik sendiri"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- User bisa update profil sendiri (untuk set password, avatar, dll)
CREATE POLICY "profiles: update milik sendiri"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Admin bisa update semua profil (approve/reject, ubah role)
CREATE POLICY "profiles: admin update semua"
  ON public.profiles FOR UPDATE
  USING (public.is_admin());

-- Admin bisa hapus profil (opsional)
CREATE POLICY "profiles: admin hapus"
  ON public.profiles FOR DELETE
  USING (public.is_admin());

-- ── mapel ──────────────────────────────────────────────────

-- User yang sudah approved atau admin bisa lihat mapel
CREATE POLICY "mapel: approved dapat lihat"
  ON public.mapel FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND (status = 'approved' OR role = 'admin')
    )
  );

-- Admin bisa kelola mapel (insert, update, delete)
CREATE POLICY "mapel: admin kelola"
  ON public.mapel FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── kisi_kisi ──────────────────────────────────────────────

-- User approved atau admin bisa baca kisi-kisi dari mapel yang terbuka
CREATE POLICY "kisi_kisi: approved dapat lihat"
  ON public.kisi_kisi FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.mapel m ON m.id = kisi_kisi.mapel_id
      WHERE p.user_id = auth.uid()
        AND (p.status = 'approved' OR p.role = 'admin')
        AND (m.is_locked = FALSE OR p.role = 'admin')
    )
  );

-- Admin bisa kelola kisi-kisi
CREATE POLICY "kisi_kisi: admin kelola"
  ON public.kisi_kisi FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── activity_log ───────────────────────────────────────────

-- User bisa baca log milik sendiri
CREATE POLICY "activity_log: baca milik sendiri"
  ON public.activity_log FOR SELECT
  USING (auth.uid() = user_id);

-- Admin bisa baca semua log
CREATE POLICY "activity_log: admin baca semua"
  ON public.activity_log FOR SELECT
  USING (public.is_admin());

-- Siapa saja yang login bisa insert log
CREATE POLICY "activity_log: insert saat login"
  ON public.activity_log FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
--  REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mapel;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kisi_kisi;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;

-- ============================================================
--  SEED: MATA PELAJARAN
-- ============================================================

INSERT INTO public.mapel (nama, icon, deskripsi, is_locked, color_from, color_to, urutan) VALUES
  ('Matematika',       '📐', 'Kisi-kisi Matematika 8F',       FALSE, '#f5a623', '#ef4444',  1),
  ('Bahasa Indonesia', '📖', 'Kisi-kisi Bahasa Indonesia 8F', FALSE, '#2dd48e', '#059669',  2),
  ('Bahasa Inggris',   '🌍', 'Kisi-kisi Bahasa Inggris 8F',  FALSE, '#4f8ef7', '#3a6fd8',  3),
  ('IPA',              '🔬', 'Kisi-kisi IPA 8F',              TRUE,  '#9b7ef8', '#7c3aed',  4),
  ('IPS',              '🗺️', 'Kisi-kisi IPS 8F',              TRUE,  '#f25c5c', '#c53030',  5),
  ('PPKn',             '🏛️', 'Kisi-kisi PPKn 8F',             TRUE,  '#06b6d4', '#0891b2',  6),
  ('Informatika',      '💻', 'Kisi-kisi Informatika 8F',      FALSE, '#6366f1', '#4f46e5',  7),
  ('Seni Budaya',      '🎨', 'Kisi-kisi Seni Budaya 8F',      TRUE,  '#f97316', '#ea580c',  8),
  ('PJOK',             '⚽', 'Kisi-kisi PJOK 8F',             TRUE,  '#84cc16', '#65a30d',  9),
  ('Prakarya',         '🔧', 'Kisi-kisi Prakarya 8F',         TRUE,  '#14b8a6', '#0d9488', 10)
ON CONFLICT DO NOTHING;

-- ============================================================
--  SEED: CONTOH KISI-KISI
-- ============================================================

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id,
  'Aljabar & Persamaan Linear',
  E'## Materi Utama\n\n**1. Persamaan Linear Satu Variabel (PLSV)**\n- Bentuk umum: ax + b = c\n- Cara menyelesaikan: pindah ruas, operasi invers\n- Penerapan dalam soal cerita\n\n**2. Persamaan Linear Dua Variabel (PLDV)**\n- Bentuk umum: ax + by = c\n- Metode substitusi, eliminasi, gabungan\n\n**3. Pertidaksamaan Linear**\n- Tanda: <, >, ≤, ≥\n- Penyelesaian di garis bilangan\n\n## Tips Ujian\n> Tulis setiap langkah secara sistematis dan periksa kembali jawabanmu!',
  'materi', 1
FROM public.mapel m WHERE m.nama = 'Matematika';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id,
  'Geometri Bangun Datar',
  E'## Rumus Penting\n\n**Persegi:** L = s² · K = 4s\n**Persegi Panjang:** L = p×l · K = 2(p+l)\n**Segitiga:** L = ½×a×t\n**Lingkaran:** L = πr² · K = 2πr\n\n**Teorema Pythagoras:**\na² + b² = c²\nTripel Pythagoras: (3,4,5) · (5,12,13) · (8,15,17)\n\n## Contoh Soal\n1. Persegi panjang 12×8 cm — hitung luas dan keliling!\n2. Segitiga siku-siku sisi 6 & 8 cm — hitung hipotenusa!',
  'soal', 2
FROM public.mapel m WHERE m.nama = 'Matematika';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id,
  'Teks Eksposisi & Argumentasi',
  E'## Struktur Teks Eksposisi\n\n1. **Tesis** — pernyataan pendapat/sudut pandang penulis\n2. **Argumentasi** — alasan yang didukung fakta & data\n3. **Penegasan Ulang** — simpulan dan penekanan kembali\n\n## Ciri Kebahasaan\n- Konjungsi kausalitas: *karena, sebab, oleh karena itu*\n- Konjungsi temporal: *pertama, kemudian, akhirnya*\n- Kata kerja mental & relasional\n- Kalimat fakta vs opini\n\n## Tips\n> Eksposisi = menjelaskan · Argumentasi = meyakinkan',
  'materi', 1
FROM public.mapel m WHERE m.nama = 'Bahasa Indonesia';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id,
  'Simple Past & Present Perfect',
  E'## Simple Past Tense\n- **Rumus:** Subject + V2\n- **Signal words:** yesterday, last week/month/year, ago, in + tahun lalu\n- *She **visited** her grandmother last Sunday.*\n\n## Present Perfect Tense\n- **Rumus:** Subject + have/has + V3\n- **Signal words:** already, just, yet, ever, never, since, for\n- *I **have finished** my homework already.*\n\n## Perbedaan Utama\n| Simple Past | Present Perfect |\n|---|---|\n| Waktu spesifik disebutkan | Waktu tidak perlu spesifik |\n| Kejadian sudah selesai total | Masih relevan dengan sekarang |\n\n## Vocabulary\n- Academic words · Phrasal verbs: *give up, look forward to, put off*',
  'materi', 1
FROM public.mapel m WHERE m.nama = 'Bahasa Inggris';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id,
  'Algoritma & Pemrograman',
  E'## Pengertian Algoritma\nLangkah-langkah logis dan sistematis untuk menyelesaikan masalah.\n\n**Karakteristik:** Input · Output · Definiteness · Finiteness · Effectiveness\n\n## Flowchart\n- **Oval** — Mulai / Selesai\n- **Persegi panjang** — Proses\n- **Belah ketupat** — Keputusan (if/else)\n- **Jajar genjang** — Input / Output\n\n## Pseudocode\n```\nBEGIN\n  IF kondisi THEN\n    lakukan sesuatu\n  ELSE\n    lakukan yang lain\n  ENDIF\nEND\n```\n\n## Struktur Dasar Pemrograman\n1. **Sequence** — urutan instruksi\n2. **Selection** — percabangan (if-else)\n3. **Repetition** — perulangan (for, while)',
  'materi', 1
FROM public.mapel m WHERE m.nama = 'Informatika';

-- ============================================================
--  CATATAN PENTING — BACA SEBELUM DEPLOY
-- ============================================================
--
--  1. SUPABASE AUTH SETTINGS
--     Dashboard → Authentication → Settings → Email
--     ✅ Aktifkan "Enable Email OTP"
--     ✅ Ganti OTP Expiry jika perlu (default 3600 detik = 1 jam)
--     ⛔ Matikan "Enable email confirmations"
--        (karena kita pakai OTP manual, bukan magic link)
--
--  2. CARA DAFTAR ADMIN
--     - Buka form Daftar di aplikasi
--     - Pilih role "⭐ Admin"
--     - Masukkan kode rahasia: qwerty
--     - OTP dikirim ke email → verifikasi → langsung masuk Admin Panel
--     ⚠️  Ganti kode rahasia di supabase.js (ADMIN_SECRET_CODE)!
--
--  3. GOOGLE OAUTH (opsional)
--     Dashboard → Authentication → Providers → Google → Enable
--     Isi Client ID & Client Secret dari Google Cloud Console
--     Tambahkan Authorized Redirect URI dari Supabase ke Google Console
--
--  4. SUPABASE URL & KEY
--     Isi SUPABASE_URL dan SUPABASE_ANON_KEY di file supabase.js
--     Dashboard → Settings → API
--
--  5. SEED ADMIN MANUAL (opsional — jika tidak mau daftar via app)
--     Buat user di Dashboard → Authentication → Users → Add User
--     Salin UUID-nya, lalu jalankan:
--
--     INSERT INTO public.profiles (user_id, nama_lengkap, email, kelas, role, status)
--     VALUES ('UUID_DISINI', 'Nama Admin', 'email@admin.com', '8F', 'admin', 'approved')
--     ON CONFLICT (email) DO UPDATE SET role='admin', status='approved';
--
-- ============================================================
