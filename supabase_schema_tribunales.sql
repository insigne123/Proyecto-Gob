-- =========================================================
-- Modulo Scraping Tribunal Ambiental (Causas y Documentos)
-- =========================================================

create table if not exists gob_tribunal_causes (
  id uuid default gen_random_uuid() primary key,
  tribunal text not null, -- ej. '1TA', '2TA', '3TA'
  rol text not null,
  fecha_ingreso date,
  caratula text not null,
  estado_subtipo text,
  estado text,
  link_causa text,
  
  -- Para saber si la hemos procesado por completo o cuándo fue la última vez
  last_scraped_at timestamp with time zone,
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_tribunal_causes_rol_idx on gob_tribunal_causes(rol);
create index if not exists gob_tribunal_causes_tribunal_idx on gob_tribunal_causes(tribunal);
create unique index if not exists gob_tribunal_causes_tribunal_rol_uidx on gob_tribunal_causes(tribunal, rol);

create table if not exists gob_tribunal_documents (
  id uuid default gen_random_uuid() primary key,
  cause_id uuid references gob_tribunal_causes(id) on delete cascade not null,
  document_type text not null, -- 'escrito inicial', 'Evacua Informe', 'sentencia', etc.
  date date,
  fojas text,
  name text,
  storage_path text, -- Path en el bucket de storage (ej: gob_sources)
  url text, -- URL original de descarga
  cod_asiento text,
  cod_documento text,
  source_origin text default 'legacy',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_tribunal_documents_cause_idx on gob_tribunal_documents(cause_id);
create index if not exists gob_tribunal_documents_type_idx on gob_tribunal_documents(document_type);
create index if not exists gob_tribunal_documents_cod_documento_idx on gob_tribunal_documents(cod_documento);
create unique index if not exists gob_tribunal_documents_cause_asiento_uidx
  on gob_tribunal_documents(cause_id, cod_asiento)
  where cod_asiento is not null;

create table if not exists gob_tribunal_cause_updates (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  source text not null default 'estado_diario',
  source_date date,
  tribunal text not null,
  cause_id uuid references gob_tribunal_causes(id) on delete cascade,
  rol text not null,
  previous_estado text,
  current_estado text,
  previous_estado_subtipo text,
  current_estado_subtipo text,
  previous_movimiento text,
  current_movimiento text,
  has_casacion boolean not null default false,
  recurso_tipo text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_tribunal_cause_updates_date_idx on gob_tribunal_cause_updates(source_date, tribunal, rol);
create index if not exists gob_tribunal_cause_updates_cause_idx on gob_tribunal_cause_updates(cause_id, created_at desc);

-- =========================================================
-- RLS (Row Level Security)
-- =========================================================
alter table gob_tribunal_causes enable row level security;
alter table gob_tribunal_documents enable row level security;
alter table gob_tribunal_cause_updates enable row level security;

-- Al ser datos públicos, todos los usuarios autenticados pueden leer.
-- La inserción (INSERT/UPDATE) vendrá del Worker de Scraping que usará
-- la Service_Role Key de Supabase (saltándose el RLS).
drop policy if exists "tribunal_causes_select" on gob_tribunal_causes;
create policy "tribunal_causes_select" on gob_tribunal_causes
  for select
  to authenticated
  using (true);

drop policy if exists "tribunal_documents_select" on gob_tribunal_documents;
create policy "tribunal_documents_select" on gob_tribunal_documents
  for select
  to authenticated
  using (true);

drop policy if exists "tribunal_cause_updates_select" on gob_tribunal_cause_updates;
create policy "tribunal_cause_updates_select" on gob_tribunal_cause_updates
  for select
  to authenticated
  using (true);

-- Otorgar persistencia genérica a roles autenticados (buenas prácticas pg)
grant select on public.gob_tribunal_causes to authenticated;
grant select on public.gob_tribunal_documents to authenticated;
grant select on public.gob_tribunal_cause_updates to authenticated;

-- =========================================================
-- Onboarding defense pool + profiles
-- =========================================================

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
