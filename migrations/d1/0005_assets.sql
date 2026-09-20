-- One row per uploaded image. The bytes live in the ASSETS KV namespace under
-- the same id; this table exists so the API can answer "how much has this
-- account stored" (the per-account quota in lib/server/assets.ts) and "does this
-- image belong to the caller" (delete) without listing KV.
CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_user ON assets(user_id);
