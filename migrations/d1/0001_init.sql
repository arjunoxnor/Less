-- LESS on Cloudflare D1. Mirrors the old Supabase tables so the client sync
-- logic is unchanged: per-user rows, last-write-wins by updated_at, folders as
-- the organizing layer, and immutable version snapshots. Access is scoped by
-- the Pages Function (which reads the signed-in Google user), so there is no
-- row-level-security layer here; the API never returns another user's rows.

CREATE TABLE IF NOT EXISTS scripts (
  user_id     TEXT NOT NULL,
  id          TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'screenplay',
  title       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'not_started',
  content     TEXT,            -- JSON document
  title_page  TEXT,            -- JSON or NULL
  folder_id   TEXT,
  position    INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_scripts_user ON scripts(user_id);

CREATE TABLE IF NOT EXISTS folders (
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  color      TEXT,
  stage      TEXT,
  parent_id  TEXT,
  position   INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

CREATE TABLE IF NOT EXISTS script_versions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  script_id  TEXT NOT NULL,
  content    TEXT NOT NULL,
  title_page TEXT,
  label      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_script ON script_versions(user_id, script_id, created_at);
