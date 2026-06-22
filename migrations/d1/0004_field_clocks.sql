-- Dedicated last-change clocks for title and status, mirroring placed_at for
-- placement. The shared updated_at is bumped by EVERY PATCH (a status change
-- bumps it even though the title did not move), so it cannot arbitrate per-field
-- last-write-wins: an unrelated remote status/folder change would make a stale
-- cloud title look "newer" and clobber a pending local rename (and vice versa).
-- A per-field clock makes each field converge on its own real edit time.
ALTER TABLE scripts ADD COLUMN title_at TEXT;
ALTER TABLE scripts ADD COLUMN status_at TEXT;
UPDATE scripts SET title_at = updated_at WHERE title_at IS NULL;
UPDATE scripts SET status_at = updated_at WHERE status_at IS NULL;
