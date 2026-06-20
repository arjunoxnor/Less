-- Phase 7: projects are typed (screenplay | plain) and carry a manual status.
-- Additive + defaulted + idempotent, so every existing row stays valid with no
-- backfill. RLS is unchanged (all policies key on user_id); script_versions is
-- untouched (its content/title_page jsonb already store plain docs fine).

alter table public.scripts
  add column if not exists type text not null default 'screenplay',
  add column if not exists status text not null default 'writing';

-- Constrain to the allowed unions. Dropped-then-created so re-running is safe
-- (add constraint has no IF NOT EXISTS in Postgres).
alter table public.scripts drop constraint if exists scripts_type_check;
alter table public.scripts
  add constraint scripts_type_check check (type in ('screenplay', 'plain'));

alter table public.scripts drop constraint if exists scripts_status_check;
alter table public.scripts
  add constraint scripts_status_check check (status in ('not_started', 'writing', 'done'));
