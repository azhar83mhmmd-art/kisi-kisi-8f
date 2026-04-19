-- KisiKisi 8F — Setup v6 (compact)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- DROP
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS trg_kisi_kisi_updated_at ON public.kisi_kisi;
DROP TRIGGER IF EXISTS trg_questions_updated_at ON public.questions;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_role() CASCADE;
DROP TABLE IF EXISTS public.site_ratings,public.user_presence,public.quiz_results,
  public.activity_log,public.broadcasts,public.options,public.questions,
  public.kisi_kisi,public.mapel,public.profiles CASCADE;

-- TABLES
CREATE TABLE public.profiles(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nama_lengkap TEXT NOT NULL, email TEXT NOT NULL UNIQUE, kelas TEXT NOT NULL DEFAULT '8F',
  role TEXT NOT NULL DEFAULT 'siswa' CHECK(role IN('siswa','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),
  avatar_url TEXT, nama_manual BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.mapel(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nama TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '📚', deskripsi TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT TRUE,
  color_from TEXT NOT NULL DEFAULT '#4f8ef7', color_to TEXT NOT NULL DEFAULT '#9b7ef8',
  urutan INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.kisi_kisi(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapel_id UUID NOT NULL REFERENCES public.mapel(id) ON DELETE CASCADE,
  judul TEXT NOT NULL, konten TEXT NOT NULL,
  tipe TEXT NOT NULL DEFAULT 'materi' CHECK(tipe IN('materi','soal','catatan')),
  urutan INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.questions(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mapel_id UUID NOT NULL REFERENCES public.mapel(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'mcq' CHECK(type IN('mcq','multiple','essay')),
  explanation TEXT, created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  urutan INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.options(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL, is_correct BOOLEAN NOT NULL DEFAULT FALSE, urutan INT NOT NULL DEFAULT 0
);
CREATE TABLE public.broadcasts(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL DEFAULT 'Pengumuman', message TEXT NOT NULL, image_url TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.activity_log(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.quiz_results(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mapel_id UUID NOT NULL REFERENCES public.mapel(id) ON DELETE CASCADE,
  nama_lengkap TEXT NOT NULL, score INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0, pct INT NOT NULL DEFAULT 0, time_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.user_presence(
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nama_lengkap TEXT NOT NULL, last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  page TEXT NOT NULL DEFAULT 'dashboard'
);
CREATE TABLE public.site_ratings(
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nama_lengkap TEXT NOT NULL, rating INT NOT NULL CHECK(rating BETWEEN 1 AND 5),
  komentar TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- INDEXES
CREATE INDEX ON public.profiles(user_id);
CREATE INDEX ON public.profiles(status);
CREATE INDEX ON public.mapel(urutan);
CREATE INDEX ON public.kisi_kisi(mapel_id,urutan);
CREATE INDEX ON public.questions(mapel_id);
CREATE INDEX ON public.options(question_id);
CREATE INDEX ON public.quiz_results(mapel_id,pct DESC,time_ms ASC);
CREATE INDEX ON public.user_presence(last_seen DESC);

-- FUNCTIONS
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=NOW(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles(user_id,nama_lengkap,email,kelas,role,status,nama_manual)
  VALUES(NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nama_lengkap',NEW.raw_user_meta_data->>'full_name',split_part(NEW.email,'@',1)),
    NEW.email, COALESCE(NEW.raw_user_meta_data->>'kelas','8F'),
    COALESCE(NEW.raw_user_meta_data->>'role','siswa'),'pending',FALSE)
  ON CONFLICT(user_id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND role='admin');
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE user_id=auth.uid() LIMIT 1;
$$;

-- TRIGGERS
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_kisi_kisi_updated_at BEFORE UPDATE ON public.kisi_kisi FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_questions_updated_at BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kisi_kisi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_ratings ENABLE ROW LEVEL SECURITY;

-- POLICIES: profiles (pakai get_my_role() bukan is_admin() — hindari rekursi)
CREATE POLICY "p_sel" ON public.profiles FOR SELECT USING(auth.uid()=user_id OR public.get_my_role()='admin');
CREATE POLICY "p_ins" ON public.profiles FOR INSERT WITH CHECK(auth.uid()=user_id);
CREATE POLICY "p_upd" ON public.profiles FOR UPDATE USING(auth.uid()=user_id OR public.get_my_role()='admin');
CREATE POLICY "p_del" ON public.profiles FOR DELETE USING(public.get_my_role()='admin');

-- POLICIES: mapel
CREATE POLICY "m_sel" ON public.mapel FOR SELECT USING(EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND(status='approved' OR role='admin')));
CREATE POLICY "m_adm" ON public.mapel FOR ALL USING(public.is_admin()) WITH CHECK(public.is_admin());

-- POLICIES: kisi_kisi
CREATE POLICY "k_sel" ON public.kisi_kisi FOR SELECT USING(EXISTS(SELECT 1 FROM public.profiles p JOIN public.mapel m ON m.id=kisi_kisi.mapel_id WHERE p.user_id=auth.uid() AND(p.status='approved' OR p.role='admin') AND(NOT m.is_locked OR p.role='admin')));
CREATE POLICY "k_adm" ON public.kisi_kisi FOR ALL USING(public.is_admin()) WITH CHECK(public.is_admin());

-- POLICIES: questions
CREATE POLICY "q_sel" ON public.questions FOR SELECT USING(EXISTS(SELECT 1 FROM public.profiles p JOIN public.mapel m ON m.id=questions.mapel_id WHERE p.user_id=auth.uid() AND(p.status='approved' OR p.role='admin') AND(NOT m.is_locked OR p.role='admin')));
CREATE POLICY "q_adm" ON public.questions FOR ALL USING(public.is_admin()) WITH CHECK(public.is_admin());

-- POLICIES: options
CREATE POLICY "o_sel" ON public.options FOR SELECT USING(EXISTS(SELECT 1 FROM public.questions q JOIN public.profiles p ON p.user_id=auth.uid() JOIN public.mapel m ON m.id=q.mapel_id WHERE q.id=options.question_id AND(p.status='approved' OR p.role='admin') AND(NOT m.is_locked OR p.role='admin')));
CREATE POLICY "o_adm" ON public.options FOR ALL USING(public.is_admin()) WITH CHECK(public.is_admin());

-- POLICIES: broadcasts
CREATE POLICY "b_sel" ON public.broadcasts FOR SELECT USING(auth.uid() IS NOT NULL);
CREATE POLICY "b_ins" ON public.broadcasts FOR INSERT WITH CHECK(public.is_admin());

-- POLICIES: activity_log
CREATE POLICY "al_sel" ON public.activity_log FOR SELECT USING(auth.uid()=user_id OR public.is_admin());
CREATE POLICY "al_ins" ON public.activity_log FOR INSERT WITH CHECK(auth.uid() IS NOT NULL);

-- POLICIES: quiz_results
CREATE POLICY "qr_ins" ON public.quiz_results FOR INSERT WITH CHECK(auth.uid() IS NOT NULL);
CREATE POLICY "qr_sel" ON public.quiz_results FOR SELECT USING(auth.uid() IS NOT NULL);

-- POLICIES: user_presence
CREATE POLICY "up_own" ON public.user_presence FOR ALL USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);
CREATE POLICY "up_adm" ON public.user_presence FOR SELECT USING(public.is_admin());

-- POLICIES: site_ratings
CREATE POLICY "sr_ins" ON public.site_ratings FOR INSERT WITH CHECK(auth.uid() IS NOT NULL AND auth.uid()=user_id);
CREATE POLICY "sr_own" ON public.site_ratings FOR SELECT USING(auth.uid()=user_id);
CREATE POLICY "sr_adm" ON public.site_ratings FOR SELECT USING(public.is_admin());

-- STORAGE
INSERT INTO storage.buckets(id,name,public) VALUES('broadcast-images','broadcast-images',true) ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS "broadcast images: admin upload" ON storage.objects;
DROP POLICY IF EXISTS "broadcast images: public read" ON storage.objects;
CREATE POLICY "broadcast images: admin upload" ON storage.objects FOR INSERT WITH CHECK(bucket_id='broadcast-images' AND public.is_admin());
CREATE POLICY "broadcast images: public read" ON storage.objects FOR SELECT USING(bucket_id='broadcast-images' AND auth.uid() IS NOT NULL);

-- REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles,public.mapel,public.kisi_kisi,
  public.questions,public.options,public.broadcasts,public.quiz_results,public.user_presence;

-- SEED: MAPEL
INSERT INTO public.mapel(nama,icon,deskripsi,is_locked,color_from,color_to,urutan) VALUES
('Matematika','📐','Kisi-kisi Matematika 8F',FALSE,'#f5a623','#ef4444',1),
('Bahasa Indonesia','📖','Kisi-kisi Bahasa Indonesia 8F',FALSE,'#2dd48e','#059669',2),
('Bahasa Inggris','🌍','Kisi-kisi Bahasa Inggris 8F',FALSE,'#4f8ef7','#3a6fd8',3),
('IPA','🔬','Kisi-kisi IPA 8F',TRUE,'#9b7ef8','#7c3aed',4),
('IPS','🗺️','Kisi-kisi IPS 8F',TRUE,'#f25c5c','#c53030',5),
('PPKn','🏛️','Kisi-kisi PPKn 8F',TRUE,'#06b6d4','#0891b2',6),
('Informatika','💻','Kisi-kisi Informatika 8F',FALSE,'#6366f1','#4f46e5',7),
('Seni Budaya','🎨','Kisi-kisi Seni Budaya 8F',TRUE,'#f97316','#ea580c',8),
('PJOK','⚽','Kisi-kisi PJOK 8F',TRUE,'#84cc16','#65a30d',9),
('Prakarya','🔧','Kisi-kisi Prakarya 8F',TRUE,'#14b8a6','#0d9488',10);

-- SEED: KISI-KISI
INSERT INTO public.kisi_kisi(mapel_id,judul,konten,tipe,urutan)
SELECT id,'Aljabar & Persamaan Linear',E'## Materi Utama\n\n**1. PLSV** — ax + b = c\n- Selesaikan dengan pindah ruas & operasi invers\n\n**2. PLDV** — ax + by = c\n- Metode: substitusi · eliminasi · gabungan\n\n**3. Pertidaksamaan Linear**\n- Tanda: <, >, ≤, ≥ · gambar di garis bilangan\n\n> Tips: tulis setiap langkah secara sistematis!','materi',1 FROM public.mapel WHERE nama='Matematika';

INSERT INTO public.kisi_kisi(mapel_id,judul,konten,tipe,urutan)
SELECT id,'Geometri Bangun Datar',E'## Rumus Penting\n\n- **Persegi:** L=s² · K=4s\n- **Persegi panjang:** L=p×l · K=2(p+l)\n- **Segitiga:** L=½×a×t\n- **Lingkaran:** L=πr² · K=2πr\n\n**Pythagoras:** a²+b²=c²\nTripel: (3,4,5)·(5,12,13)·(8,15,17)','soal',2 FROM public.mapel WHERE nama='Matematika';

INSERT INTO public.kisi_kisi(mapel_id,judul,konten,tipe,urutan)
SELECT id,'Teks Eksposisi & Argumentasi',E'## Struktur\n1. **Tesis** — pernyataan pendapat penulis\n2. **Argumentasi** — alasan + fakta/data\n3. **Penegasan Ulang** — simpulan\n\n## Ciri Kebahasaan\n- Konjungsi kausalitas: *karena, sebab, oleh karena itu*\n- Konjungsi temporal: *pertama, kemudian, akhirnya*','materi',1 FROM public.mapel WHERE nama='Bahasa Indonesia';

INSERT INTO public.kisi_kisi(mapel_id,judul,konten,tipe,urutan)
SELECT id,'Simple Past & Present Perfect',E'## Simple Past\n- Rumus: S+V2 · Signal: yesterday, last week, ago\n\n## Present Perfect\n- Rumus: S+have/has+V3 · Signal: already, yet, ever, never, since, for','materi',1 FROM public.mapel WHERE nama='Bahasa Inggris';

INSERT INTO public.kisi_kisi(mapel_id,judul,konten,tipe,urutan)
SELECT id,'Algoritma & Pemrograman',E'## Algoritma\nLangkah logis & sistematis untuk menyelesaikan masalah.\n\n**Simbol Flowchart:**\n- Oval→Mulai/Selesai · Persegi→Proses · Belah ketupat→Keputusan\n\n## Struktur\n1. Sequence 2. Selection(if-else) 3. Repetition(for/while)','materi',1 FROM public.mapel WHERE nama='Informatika';

-- SEED: SOAL
WITH q AS(INSERT INTO public.questions(mapel_id,question_text,type,explanation,urutan) SELECT id,'Jika 3x + 6 = 15, berapakah nilai x?','mcq','3x=15-6=9, maka x=3.',1 FROM public.mapel WHERE nama='Matematika' RETURNING id)
INSERT INTO public.options(question_id,option_text,is_correct,urutan) SELECT q.id,v.t,v.c,v.u FROM q,(VALUES('x = 2',false,1),('x = 3',true,2),('x = 4',false,3),('x = 5',false,4))AS v(t,c,u);

WITH q AS(INSERT INTO public.questions(mapel_id,question_text,type,explanation,urutan) SELECT id,'Manakah yang termasuk bilangan prima di bawah 20?','multiple','Bilangan prima di bawah 20: 2,3,5,7,11,13,17,19.',2 FROM public.mapel WHERE nama='Matematika' RETURNING id)
INSERT INTO public.options(question_id,option_text,is_correct,urutan) SELECT q.id,v.t,v.c,v.u FROM q,(VALUES('2',true,1),('4',false,2),('7',true,3),('9',false,4),('13',true,5))AS v(t,c,u);

INSERT INTO public.questions(mapel_id,question_text,type,explanation,urutan) SELECT id,'Sebutkan 3 metode penyelesaian SPLDV dan jelaskan!','essay','1.Substitusi 2.Eliminasi 3.Gabungan',3 FROM public.mapel WHERE nama='Matematika';

WITH q AS(INSERT INTO public.questions(mapel_id,question_text,type,explanation,urutan) SELECT id,'Which sentence uses Present Perfect correctly?','mcq','"Have you ever been to Bali?" — ever+have+V3.',1 FROM public.mapel WHERE nama='Bahasa Inggris' RETURNING id)
INSERT INTO public.options(question_id,option_text,is_correct,urutan) SELECT q.id,v.t,v.c,v.u FROM q,(VALUES('She visited Jakarta yesterday.',false,1),('Have you ever been to Bali?',true,2),('He go to school every day.',false,3),('They was playing football.',false,4))AS v(t,c,u);

-- SEED: BROADCAST
INSERT INTO public.broadcasts(title,message) VALUES('Selamat Datang! 🎉','Halo Kelas 8F! Platform KisiKisi resmi aktif. Selamat belajar dan semoga ujian kalian sukses!');
