-- Server-side folder deletion records, so a folder deleted on one device does
-- not get re-uploaded by another device that still holds a local copy (the
-- "deleted folder reappears" bug). A row here means "this folder id was deleted
-- at this time"; an upsert of the same id removes the row (re-creation wins).
CREATE TABLE IF NOT EXISTS folder_tombstones (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);
