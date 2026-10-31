-- What belongs to the writer rather than to any one script. For now, their
-- spelling dictionary (lib/editor/userDictionary.ts), so a word added on one
-- computer is known on the other.
--
-- dict     JSON array of words. A write merges with what is here, never
--          replaces it, so two computers adding words at once both keep theirs.
-- dict_at  when it last gained a word.
--
-- Additive: an older app version never reads this table.

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  dict TEXT NOT NULL DEFAULT '[]',
  dict_at TEXT
);
