alter table if exists public.gob_alerts enable row level security;
alter table if exists public.gob_audit_logs enable row level security;

drop policy if exists "alerts_select" on public.gob_alerts;
create policy "alerts_select" on public.gob_alerts
  for select using (
    workspace_id is not null
    and public.gob_is_workspace_member(workspace_id)
  );

drop policy if exists "alerts_write" on public.gob_alerts;
create policy "alerts_write" on public.gob_alerts
  for all
  using (
    workspace_id is null
    or public.gob_is_workspace_member(workspace_id)
  )
  with check (
    workspace_id is null
    or public.gob_is_workspace_member(workspace_id)
  );

drop policy if exists "audit_select" on public.gob_audit_logs;
create policy "audit_select" on public.gob_audit_logs
  for select using (
    user_id = auth.uid()
    or (
      details ? 'workspace_id'
      and public.gob_is_workspace_member((details ->> 'workspace_id')::uuid)
    )
  );

drop policy if exists "audit_insert" on public.gob_audit_logs;
create policy "audit_insert" on public.gob_audit_logs
  for insert with check (
    auth.role() = 'authenticated'
    and (
      user_id is null
      or user_id = auth.uid()
    )
  );
