-- ============================================================
--  KisiKisi 8F — Complete SQL Setup v3 (Production Fixed)
--  Jalankan SEKALI di Supabase → SQL Editor → New Query
--  Versi ini mencakup: profil, mapel, kisi-kisi, soal (MCQ),
--  broadcasts, dan semua index untuk optimasi performa.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
--  DROP TABLES (urutan: child → parent, aman untuk re-run)
-- ============================================================
DROP TABLE IF EXISTS public.broadcasts    CASCADE;
DROP TABLE IF EXISTS public.options       CASCADE;
DROP TABLE IF EXISTS public.questions     CASCADE;
DROP TABLE IF EXISTS public.activity_log  CASCADE;
DROP TABLE IF EXISTS public.kisi_kisi     CASCADE;
DROP TABLE IF EXISTS public.mapel         CASCADE;
DROP TABLE IF EXISTS public.profiles      CASCADE;

-- ============================================================
--  TABLES
-- ============================================================

-- Profil pengguna (siswa & admin)
CREATE TABLE public.profiles (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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
CREATE TABLE public.mapel (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  nama       TEXT        NOT NULL,
  icon       TEXT        NOT NULL DEFAULT '📚',
  deskripsi  TEXT,
  is_locked  BOOLEAN     NOT NULL DEFAULT TRUE,
  color_from TEXT        NOT NULL DEFAULT '#4f8ef7',
  color_to   TEXT        NOT NULL DEFAULT '#9b7ef8',
  urutan     INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kisi-kisi / materi per mapel
CREATE TABLE public.kisi_kisi (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapel_id   UUID        NOT NULL REFERENCES public.mapel(id) ON DELETE CASCADE,
  judul      TEXT        NOT NULL,
  konten     TEXT        NOT NULL,
  tipe       TEXT        NOT NULL DEFAULT 'materi' CHECK (tipe IN ('materi','soal','catatan')),
  urutan     INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Soal latihan interaktif (MCQ, Multiple, Essay)
CREATE TABLE public.questions (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapel_id      UUID        NOT NULL REFERENCES public.mapel(id) ON DELETE CASCADE,
  question_text TEXT        NOT NULL,
  type          TEXT        NOT NULL DEFAULT 'mcq' CHECK (type IN ('mcq','multiple','essay')),
  explanation   TEXT,        -- Pembahasan / kunci jawaban
  created_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  urutan        INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pilihan jawaban untuk soal MCQ/Multiple
CREATE TABLE public.options (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID    NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  option_text TEXT    NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT FALSE,
  urutan      INT     NOT NULL DEFAULT 0
);

-- Broadcast admin → semua siswa
CREATE TABLE public.broadcasts (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title      TEXT        NOT NULL DEFAULT 'Pengumuman',
  message    TEXT        NOT NULL,
  created_by UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log aktivitas (opsional)
CREATE TABLE public.activity_log (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
--  INDEXES — Optimasi Performa Query
-- ============================================================
CREATE INDEX idx_profiles_user_id   ON public.profiles(user_id);
CREATE INDEX idx_profiles_status    ON public.profiles(status);
CREATE INDEX idx_profiles_role      ON public.profiles(role);
CREATE INDEX idx_mapel_urutan       ON public.mapel(urutan);
CREATE INDEX idx_mapel_is_locked    ON public.mapel(is_locked);
CREATE INDEX idx_kisi_mapel_id      ON public.kisi_kisi(mapel_id);
CREATE INDEX idx_kisi_urutan        ON public.kisi_kisi(mapel_id, urutan);
CREATE INDEX idx_questions_mapel_id ON public.questions(mapel_id);
CREATE INDEX idx_questions_type     ON public.questions(type);
CREATE INDEX idx_options_question   ON public.options(question_id);
CREATE INDEX idx_options_correct    ON public.options(question_id, is_correct);
CREATE INDEX idx_broadcasts_at      ON public.broadcasts(created_at DESC);

-- ============================================================
--  TRIGGERS — auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_profiles_updated_at  BEFORE UPDATE ON public.profiles  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_kisi_kisi_updated_at BEFORE UPDATE ON public.kisi_kisi FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_questions_updated_at BEFORE UPDATE ON public.questions  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
--  TRIGGER — Auto insert profil saat user baru daftar via OTP
--  (App juga upsert setelah OTP verify — double safety)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, nama_lengkap, email, kelas, role, status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nama_lengkap', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'kelas', '8F'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'siswa'),
    'pending'  -- Selalu pending dulu; app.js update ke approved untuk admin
  )
  ON CONFLICT (user_id) DO NOTHING; -- Aman jika trigger dipanggil 2x
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
--  HELPER FUNCTION — Cek admin tanpa rekursi RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'admin');
$$;

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapel        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kisi_kisi    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- ── profiles ───────────────────────────────────────────────
CREATE POLICY "profiles: baca milik sendiri"    ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profiles: admin baca semua"      ON public.profiles FOR SELECT USING (public.is_admin());
CREATE POLICY "profiles: insert milik sendiri"  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles: update milik sendiri"  ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "profiles: admin update semua"    ON public.profiles FOR UPDATE USING (public.is_admin());
CREATE POLICY "profiles: admin hapus"           ON public.profiles FOR DELETE USING (public.is_admin());

-- ── mapel ──────────────────────────────────────────────────
CREATE POLICY "mapel: approved lihat" ON public.mapel FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND (status='approved' OR role='admin')));
CREATE POLICY "mapel: admin kelola"   ON public.mapel FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── kisi_kisi ──────────────────────────────────────────────
CREATE POLICY "kisi: approved lihat" ON public.kisi_kisi FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.mapel m ON m.id = kisi_kisi.mapel_id
    WHERE p.user_id = auth.uid() AND (p.status='approved' OR p.role='admin') AND (m.is_locked=FALSE OR p.role='admin')
  ));
CREATE POLICY "kisi: admin kelola" ON public.kisi_kisi FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── questions ──────────────────────────────────────────────
CREATE POLICY "questions: approved lihat" ON public.questions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.mapel m ON m.id = questions.mapel_id
    WHERE p.user_id = auth.uid() AND (p.status='approved' OR p.role='admin') AND (m.is_locked=FALSE OR p.role='admin')
  ));
CREATE POLICY "questions: admin kelola" ON public.questions FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── options ────────────────────────────────────────────────
CREATE POLICY "options: approved lihat" ON public.options FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.questions q JOIN public.profiles p ON p.user_id = auth.uid()
    JOIN public.mapel m ON m.id = q.mapel_id
    WHERE q.id = options.question_id AND (p.status='approved' OR p.role='admin') AND (m.is_locked=FALSE OR p.role='admin')
  ));
CREATE POLICY "options: admin kelola" ON public.options FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ── broadcasts ─────────────────────────────────────────────
CREATE POLICY "broadcasts: login baca"  ON public.broadcasts FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "broadcasts: admin kirim" ON public.broadcasts FOR INSERT WITH CHECK (public.is_admin());

-- ── activity_log ───────────────────────────────────────────
CREATE POLICY "log: baca milik sendiri" ON public.activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "log: admin baca semua"   ON public.activity_log FOR SELECT USING (public.is_admin());
CREATE POLICY "log: insert login"       ON public.activity_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
--  REALTIME — Aktifkan semua tabel
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mapel;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kisi_kisi;
ALTER PUBLICATION supabase_realtime ADD TABLE public.questions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.options;
ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcasts;
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
--  SEED: KISI-KISI MATERI
-- ============================================================
INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id, 'Aljabar & Persamaan Linear',
E'## Materi Utama\n\n**1. Persamaan Linear Satu Variabel (PLSV)**\n- Bentuk umum: ax + b = c\n- Cara menyelesaikan: pindah ruas, operasi invers\n- Penerapan dalam soal cerita\n\n**2. Persamaan Linear Dua Variabel (PLDV)**\n- Bentuk umum: ax + by = c\n- Metode substitusi, eliminasi, gabungan\n\n**3. Pertidaksamaan Linear**\n- Tanda: <, >, ≤, ≥\n- Penyelesaian di garis bilangan\n\n## Tips Ujian\n> Tulis setiap langkah secara sistematis!',
'materi', 1
FROM public.mapel m WHERE m.nama = 'Matematika';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id, 'Geometri Bangun Datar',
E'## Rumus Penting\n\n**Persegi:** L = s² · K = 4s\n**Persegi Panjang:** L = p×l · K = 2(p+l)\n**Segitiga:** L = ½×a×t\n**Lingkaran:** L = πr² · K = 2πr\n\n**Teorema Pythagoras:**\na² + b² = c²\n\nTripel: (3,4,5) · (5,12,13) · (8,15,17)\n\n## Contoh Soal\n1. Persegi panjang 12×8 cm — hitung luas dan keliling!\n2. Segitiga siku-siku sisi 6 & 8 — hitung hipotenusa!',
'soal', 2
FROM public.mapel m WHERE m.nama = 'Matematika';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id, 'Teks Eksposisi & Argumentasi',
E'## Struktur Teks Eksposisi\n\n1. **Tesis** — pernyataan pendapat/sudut pandang penulis\n2. **Argumentasi** — alasan didukung fakta & data\n3. **Penegasan Ulang** — simpulan dan penekanan kembali\n\n## Ciri Kebahasaan\n- Konjungsi kausalitas: *karena, sebab, oleh karena itu*\n- Konjungsi temporal: *pertama, kemudian, akhirnya*\n- Kalimat fakta vs opini\n\n## Tips\n> Eksposisi = menjelaskan · Argumentasi = meyakinkan',
'materi', 1
FROM public.mapel m WHERE m.nama = 'Bahasa Indonesia';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id, 'Simple Past & Present Perfect',
E'## Simple Past Tense\n- **Rumus:** Subject + V2\n- **Signal words:** yesterday, last week, ago\n- *She **visited** her grandmother last Sunday.*\n\n## Present Perfect\n- **Rumus:** Subject + have/has + V3\n- **Signal words:** already, just, yet, ever, never, since, for\n- *I **have finished** my homework already.*\n\n## Perbedaan\n| Simple Past | Present Perfect |\n|---|---|\n| Waktu spesifik disebutkan | Waktu tidak perlu spesifik |\n| Selesai total | Masih relevan sekarang |',
'materi', 1
FROM public.mapel m WHERE m.nama = 'Bahasa Inggris';

INSERT INTO public.kisi_kisi (mapel_id, judul, konten, tipe, urutan)
SELECT m.id, 'Algoritma & Pemrograman',
E'## Pengertian Algoritma\nLangkah-langkah logis dan sistematis untuk menyelesaikan masalah.\n\n**Karakteristik:** Input · Output · Definiteness · Finiteness · Effectiveness\n\n## Flowchart\n- **Oval** — Mulai / Selesai\n- **Persegi panjang** — Proses\n- **Belah ketupat** — Keputusan (if/else)\n- **Jajar genjang** — Input / Output\n\n## Struktur Pemrograman\n1. **Sequence** — urutan instruksi\n2. **Selection** — percabangan (if-else)\n3. **Repetition** — perulangan (for, while)',
'materi', 1
FROM public.mapel m WHERE m.nama = 'Informatika';

-- ============================================================
--  SEED: SOAL LATIHAN (MCQ)
-- ============================================================

-- Soal MCQ Matematika
WITH q AS (
  INSERT INTO public.questions (mapel_id, question_text, type, explanation, urutan)
  SELECT id, 'Jika 3x + 6 = 15, berapakah nilai x?', 'mcq', 'Langkah: 3x = 15 - 6 = 9, maka x = 9 ÷ 3 = 3.', 1
  FROM public.mapel WHERE nama='Matematika' RETURNING id
)
INSERT INTO public.options (question_id, option_text, is_correct, urutan)
SELECT q.id, opt.t, opt.c, opt.u FROM q,
(VALUES ('x = 2',false,1),('x = 3',true,2),('x = 4',false,3),('x = 5',false,4)) AS opt(t,c,u)
ON CONFLICT DO NOTHING;

-- Soal Multiple Matematika
WITH q AS (
  INSERT INTO public.questions (mapel_id, question_text, type, explanation, urutan)
  SELECT id, 'Manakah yang termasuk bilangan prima di bawah 20?', 'multiple', 'Bilangan prima di bawah 20: 2, 3, 5, 7, 11, 13, 17, 19.', 2
  FROM public.mapel WHERE nama='Matematika' RETURNING id
)
INSERT INTO public.options (question_id, option_text, is_correct, urutan)
SELECT q.id, opt.t, opt.c, opt.u FROM q,
(VALUES ('2',true,1),('4',false,2),('7',true,3),('9',false,4),('13',true,5)) AS opt(t,c,u)
ON CONFLICT DO NOTHING;

-- Soal Essay Matematika
INSERT INTO public.questions (mapel_id, question_text, type, explanation, urutan)
SELECT id, 'Sebutkan 3 metode penyelesaian SPLDV dan jelaskan masing-masing!', 'essay',
'1. Substitusi: masukkan nilai satu variabel ke persamaan lain.
2. Eliminasi: kurangkan/jumlahkan persamaan untuk hilangkan satu variabel.
3. Gabungan: kombinasi eliminasi dan substitusi.', 3
FROM public.mapel WHERE nama='Matematika'
ON CONFLICT DO NOTHING;

-- Soal MCQ Bahasa Inggris
WITH q AS (
  INSERT INTO public.questions (mapel_id, question_text, type, explanation, urutan)
  SELECT id, 'Which sentence uses the Present Perfect Tense correctly?', 'mcq',
  '"Have you ever been to Bali?" is correct Present Perfect. Signal word "ever" + have/has + V3.', 1
  FROM public.mapel WHERE nama='Bahasa Inggris' RETURNING id
)
INSERT INTO public.options (question_id, option_text, is_correct, urutan)
SELECT q.id, opt.t, opt.c, opt.u FROM q,
(VALUES ('She visited Jakarta yesterday.',false,1),('Have you ever been to Bali?',true,2),('He go to school every day.',false,3),('They was playing football.',false,4)) AS opt(t,c,u)
ON CONFLICT DO NOTHING;

-- ============================================================
--  SEED: BROADCAST CONTOH
-- ============================================================
INSERT INTO public.broadcasts (title, message) VALUES
  ('Selamat Datang! 🎉', 'Halo Kelas 8F! Platform KisiKisi resmi aktif. Selamat belajar dan semoga ujian kalian sukses!')
ON CONFLICT DO NOTHING;

-- ============================================================
--  CATATAN PENTING SETELAH MENJALANKAN SQL INI
-- ============================================================
--
--  1. SUPABASE AUTH SETTINGS
--     Dashboard → Authentication → Settings → Email
--     ✅ Aktifkan "Enable Email OTP"
--     ✅ Atur OTP Expiry (default 3600 detik / 1 jam)
--     ⛔ Matikan "Enable email confirmations"
--        (karena kita pakai OTP, bukan magic link)
--
--  2. CARA DAFTAR ADMIN
--     - Buka form Daftar → pilih role "⭐ Admin"
--     - Masukkan kode rahasia: qwerty
--     - OTP dikirim ke email → verifikasi → langsung masuk Admin Panel
--     ⚠️  Ganti kode rahasia di supabase.js (ADMIN_SECRET_CODE)!
--
--  3. GOOGLE OAUTH (opsional)
--     Dashboard → Authentication → Providers → Google → Enable
--     Isi Client ID & Client Secret dari Google Cloud Console
--
--  4. REALTIME
--     Dashboard → Database → Replication
--     Pastikan tabel: profiles, mapel, kisi_kisi, questions, options, broadcasts
--     sudah ada di supabase_realtime publication.
--
--  5. JIKA INGIN RESET ULANG
--     Jalankan script ini lagi dari awal (sudah ada DROP TABLE di atas).
--     ⚠️  Semua data akan terhapus!
--
-- ============================================================
