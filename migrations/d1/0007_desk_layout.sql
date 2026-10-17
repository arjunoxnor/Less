-- The project desk: where a project's documents and folders sit.
--
-- desk     a project's layout (lib/desk/layout.ts): a list of spots, back to
--          front, each a key ("d:<doc>", "s:<stack>", "f:<folder>"), a position,
--          an optional width and an open flag. Sanitized on every write.
-- desk_at  the layout's own clock. Arranging a desk never touches updated_at,
--          so it can never out-rank a rename or a move made on another device
--          (the folder row itself converges last-write-wins on updated_at).
--
-- Additive and NULL by default: the previous app version never reads or writes
-- these columns, and its whole-row folder upsert leaves them alone.

ALTER TABLE folders ADD COLUMN desk TEXT;
ALTER TABLE folders ADD COLUMN desk_at TEXT;
