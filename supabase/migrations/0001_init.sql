-- LESS — initial schema
-- Two tables: `scripts` (the documents) and `script_versions` (rollback
-- snapshots). Both are protected by Row Level Security so a user can ONLY ever
-- read or write their own rows. The policies are written out explicitly below.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Keep updated_at fresh automatically on every UPDATE.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- scripts
-- ---------------------------------------------------------------------------
create table if not exists public.scripts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'Untitled',
  content    jsonb not null default '{}'::jsonb, -- ProseMirror/TipTap document JSON
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scripts_user_id_idx    on public.scripts(user_id);
create index if not exists scripts_user_updated_idx on public.scripts(user_id, updated_at desc);

drop trigger if exists scripts_set_updated_at on public.scripts;
create trigger scripts_set_updated_at
  before update on public.scripts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- script_versions — immutable snapshots, the rollback safety net
-- ---------------------------------------------------------------------------
create table if not exists public.script_versions (
  id         uuid primary key default gen_random_uuid(),
  script_id  uuid not null references public.scripts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    jsonb not null,
  label      text,
  created_at timestamptz not null default now()
);

create index if not exists script_versions_script_idx
  on public.script_versions(script_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.scripts          enable row level security;
alter table public.script_versions  enable row level security;

-- scripts: full CRUD, but only on rows you own (user_id = your auth uid).
drop policy if exists "scripts_select_own" on public.scripts;
create policy "scripts_select_own" on public.scripts
  for select using (auth.uid() = user_id);

drop policy if exists "scripts_insert_own" on public.scripts;
create policy "scripts_insert_own" on public.scripts
  for insert with check (auth.uid() = user_id);

drop policy if exists "scripts_update_own" on public.scripts;
create policy "scripts_update_own" on public.scripts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "scripts_delete_own" on public.scripts;
create policy "scripts_delete_own" on public.scripts
  for delete using (auth.uid() = user_id);

-- script_versions: read/create/delete your own; snapshots are never updated.
drop policy if exists "versions_select_own" on public.script_versions;
create policy "versions_select_own" on public.script_versions
  for select using (auth.uid() = user_id);

drop policy if exists "versions_insert_own" on public.script_versions;
create policy "versions_insert_own" on public.script_versions
  for insert with check (auth.uid() = user_id);

drop policy if exists "versions_delete_own" on public.script_versions;
create policy "versions_delete_own" on public.script_versions
  for delete using (auth.uid() = user_id);
