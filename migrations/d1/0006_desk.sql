-- The desk: document kinds, version stacks, and cover digests.
--
-- kind       the writer's choice of what a plain document is (treatment,
--            onepager, outline, characters, notes, document). NULL means "read it
--            from the title and folders", so existing rows need no backfill.
-- stack_id   documents sharing one are versions of the same thing.
-- stack_top  when this version was last made the current one.
-- org_at     the clock for kind + stack_id + stack_top, the same pattern as
--            placed_at for folder + position: one group, last write wins, so a
--            content save or a rename can never out-rank a regrouping.
-- digest     a small JSON summary of the content that the covers are drawn
--            from. Derived only: the API recomputes it on every content write,
--            and fills in missing ones lazily when the project list is read.
--
-- All additive and NULL by default. The previous app version ignores these
-- columns entirely, so rolling the app back needs no schema change.

ALTER TABLE scripts ADD COLUMN kind TEXT;
ALTER TABLE scripts ADD COLUMN stack_id TEXT;
ALTER TABLE scripts ADD COLUMN stack_top TEXT;
ALTER TABLE scripts ADD COLUMN org_at TEXT;
ALTER TABLE scripts ADD COLUMN digest TEXT;
