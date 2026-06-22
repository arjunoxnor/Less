-- A dedicated timestamp for *placement* (folder + position), separate from the
-- content/updated_at clock. A content save must never out-rank a real folder
-- move, and an un-file must beat a stale filed copy. Reconcile compares placed_at
-- for placement, updated_at for content. Backfill existing rows from updated_at.
ALTER TABLE scripts ADD COLUMN placed_at TEXT;
UPDATE scripts SET placed_at = updated_at WHERE placed_at IS NULL;
