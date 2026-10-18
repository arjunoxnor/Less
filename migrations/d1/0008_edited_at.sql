-- When a document's writing last changed: its words, its title page, or its
-- title. This is what the app shows as "edited" on a device that pulls the
-- document fresh (a new device, or after signing out and back in).
--
-- updated_at cannot answer that: every PATCH bumps it, so a reorder, a folder
-- move, a status change or a regrouping all read as an edit. edited_at moves
-- only on a body save, a title change and a create. Placement, status, kind,
-- stack and desk changes never touch it. It plays no part in sync decisions;
-- those stay on updated_at, the per-field clocks and the body fingerprints.
--
-- Additive and nullable: the previous app version never reads or writes it.

ALTER TABLE scripts ADD COLUMN edited_at TEXT;

-- Start every row from updated_at. That is exact whenever the last thing to
-- touch the row was a save of its words, a rename, or its creation.
UPDATE scripts SET edited_at = updated_at WHERE edited_at IS NULL;

-- Rows whose last touch was only a move, a status change or a regrouping: that
-- PATCH stamped placed_at, status_at or org_at with the same time as
-- updated_at, so the writing changed earlier. The best record of when is the
-- newest History snapshot taken by then (an editor snapshots its saves every
-- few minutes), the last rename, or the row's creation, whichever is latest.
UPDATE scripts
SET edited_at = MAX(
  created_at,
  COALESCE(CASE WHEN title_at <= updated_at THEN title_at END, created_at),
  COALESCE(
    (SELECT MAX(v.created_at) FROM script_versions v
      WHERE v.user_id = scripts.user_id
        AND v.script_id = scripts.id
        AND v.created_at <= scripts.updated_at),
    created_at
  )
)
WHERE updated_at IN (placed_at, status_at, org_at)
  AND updated_at IS NOT title_at
  AND updated_at <> created_at;
