alter table gob_onboarding_memory_artifacts
  add column if not exists version_id uuid,
  add column if not exists version_count integer not null default 1;

create index if not exists gob_onboarding_memory_artifacts_version_id_idx
  on gob_onboarding_memory_artifacts(version_id);
