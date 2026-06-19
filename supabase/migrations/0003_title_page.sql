-- Phase 6: store an optional screenplay title page beside each script.
-- Title-page metadata is NOT screenplay body, so it lives in its own nullable
-- JSONB column rather than inside the ProseMirror `content`. Nullable with no
-- default, so every existing row stays valid with zero backfill and old scripts
-- simply load with no title page.

alter table public.scripts
  add column if not exists title_page jsonb;

alter table public.script_versions
  add column if not exists title_page jsonb;
