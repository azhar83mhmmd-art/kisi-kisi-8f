-- ============================================================
--  KisiKisi 8F — SQL Setup v3 (Full Feature)
--  Jalankan di Supabase → SQL Editor → New Query
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
  -- Presence / Online tracking
  last_seen    TIMESTAMPTZ,
  is_online    BOOLEAN     DEFAULT FALSE,
  -- Ban/Block system
  ban_type     TEXT        CHECK (ban_type IN ('temp','permanent')),
  ban_until    TIMESTAMPTZ,
  ban_reason   TEXT,
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

-- Kisi-kisi / soal per mapel
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

-- Broadcast / pengumuman
CREATE TABLE IF NOT EXISTS public.broadcasts (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        TEXT        NOT NULL,
  body         TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  scheduled_at TIMESTAMPTZ,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Log aktivitas admin
CREATE TABLE IF NOT EXISTS public.activity_log (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
--  TRIGGERS
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

-- Auto-create profile on new auth user
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
    'pending'
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
ALTER TABLE public.broadcasts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('profiles','mapel','kisi_kisi','broadcasts','activity_log')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Admin helper
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

-- ── profiles ──────────────────────────────────────────────
CREATE POLICY "profiles: baca milik sendiri"
  ON public.profiles FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "profiles: admin baca semua"
  ON public.profiles FOR SELECT USING (public.is_admin());

CREATE POLICY "profiles: insert milik sendiri"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "profiles: update milik sendiri"
  ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "profiles: admin update semua"
  ON public.profiles FOR UPDATE USING (public.is_admin());

CREATE POLICY "profiles: admin hapus"
  ON public.profiles FOR DELETE USING (public.is_admin());

-- ── mapel ──────────────────────────────────────────────────
CREATE POLICY "mapel: approved dapat lihat"
  ON public.mapel FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE user_id = auth.uid()
        AND (status = 'approved' OR role = 'admin')
    )
  );

CREATE POLICY "mapel: admin kelola"
  ON public.mapel FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── kisi_kisi ──────────────────────────────────────────────
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

CREATE POLICY "kisi_kisi: admin kelola"
  ON public.kisi_kisi FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── broadcasts ────────────────────────────────────────────
CREATE POLICY "broadcasts: semua user login bisa baca"
  ON public.broadcasts FOR SELECT
  USING (auth.uid() IS NOT NULL AND active = TRUE);

CREATE POLICY "broadcasts: admin kelola"
  ON public.broadcasts FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── activity_log ───────────────────────────────────────────
CREATE POLICY "activity_log: baca milik sendiri"
  ON public.activity_log FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "activity_log: admin baca semua"
  ON public.activity_log FOR SELECT USING (public.is_admin());

CREATE POLICY "activity_log: insert saat login"
  ON public.activity_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
--  REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mapel;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kisi_kisi;
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
--  CATATAN PENTING
-- ============================================================
--
--  1. SUPABASE AUTH → Authentication → Settings → Email
--     ✅ Aktifkan "Enable Email OTP"
--     ⛔ Matikan "Enable email confirmations"
--
--  2. ADMIN_SECRET_CODE di supabase.js defaultnya "qwerty"
--     Ganti sebelum deploy!
--
--  3. Kolom baru yang ditambahkan v3:
--     profiles: last_seen, is_online, ban_type, ban_until, ban_reason
--     Table baru: broadcasts
--
--  ⚠️ Jika sudah ada tabel lama, jalankan ALTER TABLE manual:
--
--  ALTER TABLE public.profiles
--    ADD COLUMN IF NOT EXISTS last_seen    TIMESTAMPTZ,
--    ADD COLUMN IF NOT EXISTS is_online    BOOLEAN DEFAULT FALSE,
--    ADD COLUMN IF NOT EXISTS ban_type     TEXT,
--    ADD COLUMN IF NOT EXISTS ban_until    TIMESTAMPTZ,
--    ADD COLUMN IF NOT EXISTS ban_reason   TEXT;
--
-- ============================================================
