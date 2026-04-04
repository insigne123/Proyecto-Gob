create table if not exists gob_onboarding_memory_artifact_versions (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  artifact_version integer not null,
  run_id uuid,
  claim_snapshot_id uuid references gob_source_snapshots(id) on delete set null,
  summary text,
  report_content text,
  structured_memory jsonb not null default '{}'::jsonb,
  tribunal_references jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  matrix jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_by uuid references auth.users(id)
);

create unique index if not exists gob_onboarding_memory_artifact_versions_unique_idx
  on gob_onboarding_memory_artifact_versions(workspace_id, artifact_version);
create index if not exists gob_onboarding_memory_artifact_versions_workspace_idx
  on gob_onboarding_memory_artifact_versions(workspace_id, created_at desc);

alter table gob_onboarding_memory_artifact_versions enable row level security;

drop policy if exists "onboarding_memory_artifact_versions_select" on gob_onboarding_memory_artifact_versions;
create policy "onboarding_memory_artifact_versions_select" on gob_onboarding_memory_artifact_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from gob_workspace_members m
      where m.workspace_id = gob_onboarding_memory_artifact_versions.workspace_id
        and m.user_id = auth.uid()
    )
  );

grant select on public.gob_onboarding_memory_artifact_versions to authenticated;
