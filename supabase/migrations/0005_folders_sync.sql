-- Cross-device folders. A per-user `folders` table (the organizing layer), plus
-- two nullable columns on `scripts` recording which folder a project is in and
-- its manual position. Additive, idempotent, and RLS-protected exactly like the
-- existing tables, so running it is safe and changes no existing rows.

create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'New folder',
  color      text not null default '#7F77DD',
  stage      text not null default 'in_progress'
             check (stage in ('idea', 'in_progress', 'completed')),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nesting: a folder may live inside another folder (null = top level). On a
-- parent delete, children fall back to the top level rather than being removed.
alter table public.folders
  add column if not exists parent_id uuid references public.folders(id) on delete set null;

create index if not exists folders_user_idx on public.folders(user_id, position);
create index if not exists folders_parent_idx on public.folders(parent_id);

-- Reuse the updated_at trigger function created in 0001_init.sql.
drop trigger if exists folders_set_updated_at on public.folders;
create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

alter table public.folders enable row level security;

drop policy if exists "folders_select_own" on public.folders;
create policy "folders_select_own" on public.folders
  for select using (auth.uid() = user_id);

drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own" on public.folders
  for insert with check (auth.uid() = user_id);

drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own" on public.folders
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "folders_delete_own" on public.folders;
create policy "folders_delete_own" on public.folders
  for delete using (auth.uid() = user_id);

-- Folder membership + manual position on each script. Both nullable: a script
-- with no folder_id is a loose project, exactly like today.
alter table public.scripts
  add column if not exists folder_id uuid references public.folders(id) on delete set null;

alter table public.scripts
  add column if not exists position integer;

-- Optional hardening (low severity, defense-in-depth). RLS already restricts
-- every row to its owner; these add-ons also forbid pointing a script or folder
-- at a *folder* you do not own. A cross-table check cannot be a column CHECK, so
-- it lives in the RLS WITH CHECK clause. Safe to run; re-runnable.
drop policy if exists "scripts_insert_own" on public.scripts;
create policy "scripts_insert_own" on public.scripts
  for insert with check (
    auth.uid() = user_id
    and (
      folder_id is null
      or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = auth.uid())
    )
  );

drop policy if exists "scripts_update_own" on public.scripts;
create policy "scripts_update_own" on public.scripts
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (
      folder_id is null
      or exists (select 1 from public.folders f where f.id = folder_id and f.user_id = auth.uid())
    )
  );

drop policy if exists "folders_insert_own" on public.folders;
create policy "folders_insert_own" on public.folders
  for insert with check (
    auth.uid() = user_id
    and (
      parent_id is null
      or exists (select 1 from public.folders f where f.id = parent_id and f.user_id = auth.uid())
    )
  );

drop policy if exists "folders_update_own" on public.folders;
create policy "folders_update_own" on public.folders
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (
      parent_id is null
      or exists (select 1 from public.folders f where f.id = parent_id and f.user_id = auth.uid())
    )
  );
