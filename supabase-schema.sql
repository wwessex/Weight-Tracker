-- Supabase schema for Jab It (Weight Tracker)
-- Run this in your Supabase SQL Editor to set up the database tables and RLS policies.

-- =============================================
-- PROFILES (singleton — one row per user)
-- =============================================
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT DEFAULT '',
  age TEXT DEFAULT '',
  height TEXT DEFAULT '',
  height_unit TEXT DEFAULT 'cm',
  start_weight TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  medication TEXT DEFAULT 'semaglutide',
  dosage TEXT DEFAULT '',
  frequency TEXT DEFAULT 'weekly',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================
-- GOALS (singleton — one row per user)
-- =============================================
CREATE TABLE goals (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_weight TEXT DEFAULT '',
  weekly_target TEXT DEFAULT '',
  target_date TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================
-- SETTINGS (singleton — stored as JSONB blob)
-- =============================================
CREATE TABLE settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================
-- WEIGHTS (collection)
-- =============================================
CREATE TABLE weights (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  weight TEXT NOT NULL,
  note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON weights
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_weights_user_active ON weights (user_id) WHERE deleted_at IS NULL;

-- =============================================
-- JABS / DOSES (collection)
-- =============================================
CREATE TABLE jabs (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT DEFAULT '',
  medication TEXT DEFAULT '',
  dose TEXT DEFAULT '',
  dose_unit TEXT DEFAULT 'mg',
  site TEXT DEFAULT '',
  side_effects JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE jabs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON jabs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_jabs_user_active ON jabs (user_id) WHERE deleted_at IS NULL;

-- =============================================
-- MEASUREMENTS (collection)
-- =============================================
CREATE TABLE measurements (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  waist TEXT DEFAULT '',
  hips TEXT DEFAULT '',
  chest TEXT DEFAULT '',
  neck TEXT DEFAULT '',
  arm_left TEXT DEFAULT '',
  arm_right TEXT DEFAULT '',
  thigh_left TEXT DEFAULT '',
  thigh_right TEXT DEFAULT '',
  note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON measurements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_measurements_user_active ON measurements (user_id) WHERE deleted_at IS NULL;

-- =============================================
-- JOURNAL (collection)
-- =============================================
CREATE TABLE journal (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  mood INTEGER DEFAULT 3,
  energy INTEGER DEFAULT 3,
  text TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON journal
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_journal_user_active ON journal (user_id) WHERE deleted_at IS NULL;

-- =============================================
-- FASTS (collection)
-- =============================================
CREATE TABLE fasts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT DEFAULT '',
  target_hours REAL DEFAULT 16,
  protocol TEXT DEFAULT '16:8',
  completed BOOLEAN DEFAULT false,
  note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE fasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON fasts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_fasts_user_active ON fasts (user_id) WHERE deleted_at IS NULL;

-- =============================================
-- EXERCISES (collection)
-- =============================================
CREATE TABLE exercises (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  type TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  intensity TEXT DEFAULT '',
  calories TEXT DEFAULT '',
  note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON exercises
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_exercises_user_active ON exercises (user_id) WHERE deleted_at IS NULL;

-- =============================================
-- VICTORIES / NSV (collection)
-- =============================================
CREATE TABLE victories (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  category TEXT DEFAULT '',
  text TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

ALTER TABLE victories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own data" ON victories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_victories_user_active ON victories (user_id) WHERE deleted_at IS NULL;
