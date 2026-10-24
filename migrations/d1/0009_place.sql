-- Where the writer last was in a document (lib/editor/returnPlace.ts), so it
-- reopens there on any device: page 27 stays page 27, weeks later.
--
-- place     JSON {pos, line, off}: the caret, the start of its line, and how
--           far along it. Sanitized on every write.
-- place_at  its own clock. Reading a script never moves updated_at or
--           edited_at, so where you were reading can never out-rank an edit.
--
-- Additive and NULL by default: an older app version never reads or writes
-- these columns.

ALTER TABLE scripts ADD COLUMN place TEXT;
ALTER TABLE scripts ADD COLUMN place_at TEXT;
