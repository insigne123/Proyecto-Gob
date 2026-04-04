-- Onboarding defense pool and profiles (SEA-only eligible causes)

create table if not exists gob_onboarding_cause_pool (
  cause_id uuid primary key references gob_tribunal_causes(id) on delete cascade,
  tribunal text,
  rol text,
  caratula text,
  has_sea_defendant boolean not null default false,
  has_sma_token boolean not null default false,
  docs_count integer not null default 0,
  key_docs_count integer not null default 0,
  eligibility_reason text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_onboarding_cause_pool_tribunal_idx on gob_onboarding_cause_pool(tribunal);
create index if not exists gob_onboarding_cause_pool_updated_idx on gob_onboarding_cause_pool(updated_at desc);

create table if not exists gob_onboarding_cause_profiles (
  cause_id uuid primary key references gob_tribunal_causes(id) on delete cascade,
  source_hash text,
  summary text,
  interesting_if text[] not null default '{}',
  risky_if text[] not null default '{}',
  key_signals text[] not null default '{}',
  recommended_doc_roles text[] not null default '{}',
  profile_version text not null default 'v1',
  model text,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_onboarding_cause_profiles_updated_idx on gob_onboarding_cause_profiles(updated_at desc);

create table if not exists gob_onboarding_document_profiles (
  document_id uuid primary key references gob_tribunal_documents(id) on delete cascade,
  cause_id uuid references gob_tribunal_causes(id) on delete cascade,
  source_hash text,
  doc_role text,
  relevance_score numeric,
  summary text,
  key_points text[] not null default '{}',
  profile_version text not null default 'v1',
  model text,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_onboarding_document_profiles_cause_idx on gob_onboarding_document_profiles(cause_id);
create index if not exists gob_onboarding_document_profiles_role_idx on gob_onboarding_document_profiles(doc_role);

alter table gob_onboarding_cause_pool enable row level security;
alter table gob_onboarding_cause_profiles enable row level security;
alter table gob_onboarding_document_profiles enable row level security;

drop policy if exists "onboarding_cause_pool_select" on gob_onboarding_cause_pool;
create policy "onboarding_cause_pool_select" on gob_onboarding_cause_pool
  for select
  to authenticated
  using (true);

drop policy if exists "onboarding_cause_profiles_select" on gob_onboarding_cause_profiles;
create policy "onboarding_cause_profiles_select" on gob_onboarding_cause_profiles
  for select
  to authenticated
  using (true);

drop policy if exists "onboarding_document_profiles_select" on gob_onboarding_document_profiles;
create policy "onboarding_document_profiles_select" on gob_onboarding_document_profiles
  for select
  to authenticated
  using (true);

grant select on public.gob_onboarding_cause_pool to authenticated;
grant select on public.gob_onboarding_cause_profiles to authenticated;
grant select on public.gob_onboarding_document_profiles to authenticated;
