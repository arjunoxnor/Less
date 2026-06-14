-- Tighten script_versions RLS: a snapshot's ownership is anchored to the
-- PARENT SCRIPT, not just to a client-supplied user_id. Without this, an
-- authenticated user could attach forged version rows to another user's
-- script_id (an integrity violation of "only ever read/write your own rows").
-- Every policy now also requires that the referenced script is the caller's.

drop policy if exists "versions_select_own" on public.script_versions;
create policy "versions_select_own" on public.script_versions
  for select using (
    auth.uid() = user_id
    and exists (
      select 1 from public.scripts s
      where s.id = script_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "versions_insert_own" on public.script_versions;
create policy "versions_insert_own" on public.script_versions
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.scripts s
      where s.id = script_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "versions_delete_own" on public.script_versions;
create policy "versions_delete_own" on public.script_versions
  for delete using (
    auth.uid() = user_id
    and exists (
      select 1 from public.scripts s
      where s.id = script_id and s.user_id = auth.uid()
    )
  );
