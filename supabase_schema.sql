
-- =========================================================
-- Cuaderno Ambiental (Tribunal Ambiental Chile)
-- Supabase/Postgres schema (pgvector + RLS)
-- Timezone operativo: America/Santiago
-- =========================================================

-- Extensions
create extension if not exists pgcrypto;
create extension if not exists vector;

-- =========================================================
-- Core: Workspaces (Expedientes)
-- =========================================================

create table if not exists gob_workspaces (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  description text,
  allowed_domains text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) default auth.uid()
);

-- Backfill for existing installs
alter table gob_workspaces add column if not exists allowed_domains text[] not null default '{}';
alter table gob_workspaces alter column created_by set default auth.uid();

create table if not exists gob_workspace_members (
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('admin', 'analyst', 'viewer')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (workspace_id, user_id)
);

-- =========================================================
-- Expediente (Tribunal-aligned)
-- =========================================================

-- Structured metadata/profile for a workspace
create table if not exists gob_workspace_profiles (
  workspace_id uuid primary key references gob_workspaces(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  cause_type text,
  tribunal_role text,
  sea_id text,
  sea_role text,
  holder text,
  proponent text,
  region text,
  comuna text,
  latitude double precision,
  longitude double precision,
  procedural_status text,
  key_dates jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_by uuid references auth.users(id)
);

-- Parties and actors
create table if not exists gob_workspace_parties (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  role text not null check (
    role in (
      'demandante',
      'reclamante',
      'reclamado',
      'tercero',
      'abogado',
      'perito',
      'titular',
      'proponente',
      'autoridad',
      'otro'
    )
  ),
  name text not null,
  entity_type text not null default 'organizacion' check (entity_type in ('persona', 'organizacion')),
  contact_email text,
  contact_phone text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id)
);

create index if not exists gob_workspace_parties_ws_idx on gob_workspace_parties(workspace_id, created_at desc);

-- Timeline (hitos)
create table if not exists gob_workspace_timeline_events (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  occurred_at timestamp with time zone,
  kind text not null default 'otro' check (kind in ('ingreso', 'oficio', 'informe', 'audiencia', 'resolucion', 'otro')),
  title text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id)
);

create index if not exists gob_workspace_timeline_ws_idx on gob_workspace_timeline_events(workspace_id, occurred_at desc, created_at desc);

-- Links from timeline events to evidence snapshots
create table if not exists gob_workspace_timeline_event_snapshots (
  event_id uuid references gob_workspace_timeline_events(id) on delete cascade not null,
  snapshot_id uuid references gob_source_snapshots(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  primary key (event_id, snapshot_id)
);

-- Workspace invitations (by email)
create table if not exists gob_workspace_invites (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  email text not null,
  role text not null check (role in ('admin', 'analyst', 'viewer')),
  token text not null unique,
  expires_at timestamp with time zone,
  accepted_at timestamp with time zone,
  accepted_by uuid references auth.users(id),
  created_by uuid references auth.users(id)
);

create index if not exists gob_workspace_invites_ws_idx on gob_workspace_invites(workspace_id, created_at desc);

-- Helpers (require gob_workspace_members)
create or replace function gob_is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from gob_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function gob_is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from gob_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

create or replace function gob_is_workspace_writer(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from gob_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.role in ('admin', 'analyst')
  );
$$;

create index if not exists gob_workspace_members_user_idx on gob_workspace_members(user_id);

-- =========================================================
-- Module A: Sources (web + uploads) with versioned snapshots
-- =========================================================

create table if not exists gob_knowledge_bases (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null unique,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  name text not null,
  provider text not null default 'openai' check (provider in ('openai')),
  openai_vector_store_id text not null unique,
  status text not null default 'ready' check (status in ('provisioning', 'ready', 'error')),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id)
);

create index if not exists gob_knowledge_bases_workspace_idx on gob_knowledge_bases(workspace_id);

create table if not exists gob_sources (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  kind text not null check (kind in ('url', 'upload')),
  url text,
  filename text,
  title text,
  doc_type text,
  year integer,
  region text,
  sector text,
  project_name text,
  source_origin text,
  language text default 'es',
  attributes jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'error')),
  snapshots_count integer not null default 0,
  last_error text,
  created_by uuid references auth.users(id)
);

alter table gob_sources add column if not exists doc_type text;
alter table gob_sources add column if not exists year integer;
alter table gob_sources add column if not exists region text;
alter table gob_sources add column if not exists sector text;
alter table gob_sources add column if not exists project_name text;
alter table gob_sources add column if not exists source_origin text;
alter table gob_sources add column if not exists language text default 'es';
alter table gob_sources add column if not exists attributes jsonb not null default '{}'::jsonb;

create index if not exists gob_sources_workspace_idx on gob_sources(workspace_id);
create index if not exists gob_sources_doc_type_idx on gob_sources(workspace_id, doc_type);
create index if not exists gob_sources_year_idx on gob_sources(workspace_id, year);
create index if not exists gob_sources_region_idx on gob_sources(workspace_id, region);

create table if not exists gob_source_snapshots (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  source_id uuid references gob_sources(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  fetched_at timestamp with time zone,
  url text,
  original_filename text,
  storage_path text,
  content_type text,
  content_hash text,
  http_status integer,
  title text,
  openai_file_id text,
  openai_vector_store_file_id text,
  openai_index_status text not null default 'pending' check (openai_index_status in ('pending', 'indexing', 'ready', 'failed', 'deleted')),
  openai_last_error text,
  openai_indexed_at timestamp with time zone,
  openai_attributes jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'error')),
  error text
);

alter table gob_source_snapshots add column if not exists openai_file_id text;
alter table gob_source_snapshots add column if not exists openai_vector_store_file_id text;
alter table gob_source_snapshots add column if not exists openai_index_status text not null default 'pending' check (openai_index_status in ('pending', 'indexing', 'ready', 'failed', 'deleted'));
alter table gob_source_snapshots add column if not exists openai_last_error text;
alter table gob_source_snapshots add column if not exists openai_indexed_at timestamp with time zone;
alter table gob_source_snapshots add column if not exists openai_attributes jsonb not null default '{}'::jsonb;

create index if not exists gob_source_snapshots_source_idx on gob_source_snapshots(source_id, created_at desc);
create index if not exists gob_source_snapshots_openai_file_idx on gob_source_snapshots(openai_file_id);
create index if not exists gob_source_snapshots_openai_status_idx on gob_source_snapshots(workspace_id, openai_index_status, created_at desc);

-- Chunks for strict RAG
create table if not exists gob_chunks (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  snapshot_id uuid references gob_source_snapshots(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  content text not null,
  embedding vector(768),
  source_url text,
  page integer,
  section text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_chunks_workspace_idx on gob_chunks(workspace_id);
create index if not exists gob_chunks_snapshot_idx on gob_chunks(snapshot_id);
create index if not exists gob_chunks_tsv_idx on gob_chunks using gin (to_tsvector('spanish', coalesce(content, '')));

-- Vector index (requires enough rows for ivfflat to be effective)
create index if not exists gob_chunks_embedding_idx on gob_chunks using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

-- =========================================================
-- Chat + Notes + Reports
-- =========================================================

-- Chat threads (hilos) per expediente
create table if not exists gob_chat_threads (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text not null,
  purpose text,
  mode text not null default 'extractive' check (mode in ('extractive', 'comparison', 'checklist', 'resolution')),
  created_by uuid references auth.users(id)
);

create index if not exists gob_chat_threads_ws_idx on gob_chat_threads(workspace_id, updated_at desc);

create table if not exists gob_chat_messages (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references gob_chat_threads(id) on delete cascade,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  model text,
  usage jsonb,
  created_by uuid references auth.users(id)
);

alter table gob_chat_messages add column if not exists thread_id uuid references gob_chat_threads(id) on delete cascade;

create index if not exists gob_chat_messages_ws_idx on gob_chat_messages(workspace_id, created_at);

create table if not exists gob_notes (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  title text,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  visibility text not null default 'shared' check (visibility in ('shared', 'private')),
  created_by uuid references auth.users(id)
);

alter table gob_notes add column if not exists visibility text not null default 'shared' check (visibility in ('shared', 'private'));

create index if not exists gob_notes_ws_idx on gob_notes(workspace_id, created_at desc);

create table if not exists gob_reports (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  status text not null default 'draft' check (status in ('draft', 'review', 'final')),
  content_json jsonb not null,
  citations jsonb not null default '[]'::jsonb,
  created_by_model text,
  created_by uuid references auth.users(id)
);

create index if not exists gob_reports_ws_idx on gob_reports(workspace_id, created_at desc);

-- Report versions (manual saves)
create table if not exists gob_report_versions (
  id uuid default gen_random_uuid() primary key,
  report_id uuid references gob_reports(id) on delete cascade not null,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  status text,
  note text,
  content_json jsonb not null,
  created_by uuid references auth.users(id)
);

create index if not exists gob_report_versions_report_idx on gob_report_versions(report_id, created_at desc);

-- =========================================================
-- Module B: OAuth connections + Excel watchlists + runs + emails
-- =========================================================

create table if not exists gob_oauth_connections (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  provider text not null check (provider in ('google', 'microsoft')),
  user_id uuid references auth.users(id) on delete cascade not null,
  tokens_enc text not null,
  scopes text
);

create unique index if not exists gob_oauth_connections_user_provider_idx on gob_oauth_connections(user_id, provider);

create table if not exists gob_oauth_states (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  provider text not null check (provider in ('google', 'microsoft')),
  user_id uuid references auth.users(id) on delete cascade not null,
  state text not null unique,
  redirect_to text
);

create table if not exists gob_excel_watchlists (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  provider text not null check (provider in ('google', 'microsoft')),
  connection_id uuid references gob_oauth_connections(id) on delete restrict not null,
  file_id text not null,
  file_name text,
  sheet_name text,
  key_columns text[] not null,
  watched_columns text[] not null default '{}',
  check_every_minutes integer not null default 15,
  email_schedule jsonb not null default '{}'::jsonb,
  recipients text[] not null default '{}',
  rules jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  last_etag text,
  last_modified_time timestamp with time zone,
  last_checked_at timestamp with time zone,
  next_check_at timestamp with time zone,
  last_emailed_at timestamp with time zone,
  next_email_at timestamp with time zone,
  last_error text,
  created_by uuid references auth.users(id)
);

alter table gob_excel_watchlists add column if not exists rules jsonb not null default '{}'::jsonb;

create index if not exists gob_excel_watchlists_ws_idx on gob_excel_watchlists(workspace_id);
create index if not exists gob_excel_watchlists_next_check_idx on gob_excel_watchlists(next_check_at);
create index if not exists gob_excel_watchlists_next_email_idx on gob_excel_watchlists(next_email_at);

create table if not exists gob_excel_runs (
  id uuid default gen_random_uuid() primary key,
  watchlist_id uuid references gob_excel_watchlists(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  kind text not null check (kind in ('no_change', 'changed', 'error')),
  etag text,
  modified_time timestamp with time zone,
  summary jsonb not null default '{}'::jsonb,
  diff_storage_path text,
  snapshot_storage_path text,
  error text
);

create index if not exists gob_excel_runs_watch_idx on gob_excel_runs(watchlist_id, created_at desc);

create table if not exists gob_email_runs (
  id uuid default gen_random_uuid() primary key,
  watchlist_id uuid references gob_excel_watchlists(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  recipients text[] not null default '{}',
  subject text not null,
  status text not null default 'sent' check (status in ('sent', 'error', 'skipped')),
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_email_runs_watch_idx on gob_email_runs(watchlist_id, created_at desc);

-- =========================================================
-- Jobs (background worker)
-- =========================================================

-- Workers (heartbeats)
create table if not exists gob_workers (
  worker_id text primary key,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
  hostname text,
  pid integer,
  version text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_workers_last_seen_idx on gob_workers(last_seen_at desc);

create table if not exists gob_jobs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  available_at timestamp with time zone not null,
  locked_at timestamp with time zone,
  locked_by text,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  type text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  completed_at timestamp with time zone
);

create index if not exists gob_jobs_ready_idx on gob_jobs(status, available_at);

create or replace function gob_claim_jobs(p_worker_id text, p_limit integer default 5)
returns setof gob_jobs
language plpgsql
as $$
begin
  return query
  with cte as (
    select id
    from gob_jobs
    where status = 'pending'
      and available_at <= now()
    order by available_at asc
    for update skip locked
    limit p_limit
  )
  update gob_jobs j
  set status = 'running',
      locked_at = now(),
      locked_by = p_worker_id
  from cte
  where j.id = cte.id
  returning j.*;
end;
$$;

-- List jobs for a workspace (operational view)
create or replace function gob_list_jobs_for_workspace(
  p_workspace_id uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  created_at timestamp with time zone,
  available_at timestamp with time zone,
  status text,
  type text,
  attempts integer,
  max_attempts integer,
  last_error text,
  completed_at timestamp with time zone,
  payload jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    j.id,
    j.created_at,
    j.available_at,
    j.status,
    j.type,
    j.attempts,
    j.max_attempts,
    j.last_error,
    j.completed_at,
    j.payload
  from gob_jobs j
  where gob_is_workspace_member(p_workspace_id)
    and (
      (
        (j.payload ? 'workspace_id')
        and nullif(j.payload->>'workspace_id', '') is not null
        and (j.payload->>'workspace_id')::uuid = p_workspace_id
      )
      or (
        j.type = 'report_generate'
        and (j.payload ? 'report_id')
        and nullif(j.payload->>'report_id', '') is not null
        and exists(
          select 1
          from gob_reports r
          where r.id = (j.payload->>'report_id')::uuid
            and r.workspace_id = p_workspace_id
        )
      )
      or (
        j.type in ('excel_check', 'email_digest')
        and (j.payload ? 'watchlist_id')
        and nullif(j.payload->>'watchlist_id', '') is not null
        and exists(
          select 1
          from gob_excel_watchlists w
          where w.id = (j.payload->>'watchlist_id')::uuid
            and w.workspace_id = p_workspace_id
        )
      )
    )
  order by j.created_at desc
  limit p_limit;
$$;

-- Retention cleanup (basic; to prevent unbounded growth)
create or replace function gob_retention_cleanup(
  p_jobs_days integer default 30,
  p_excel_runs_days integer default 120,
  p_email_runs_days integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs integer := 0;
  v_excel integer := 0;
  v_email integer := 0;
begin
  delete from gob_jobs
  where status in ('completed', 'failed')
    and created_at < now() - make_interval(days => greatest(1, p_jobs_days));
  get diagnostics v_jobs = row_count;

  delete from gob_excel_runs
  where created_at < now() - make_interval(days => greatest(1, p_excel_runs_days));
  get diagnostics v_excel = row_count;

  delete from gob_email_runs
  where created_at < now() - make_interval(days => greatest(1, p_email_runs_days));
  get diagnostics v_email = row_count;

  return jsonb_build_object(
    'jobs', v_jobs,
    'excel_runs', v_excel,
    'email_runs', v_email,
    'at', timezone('utc'::text, now())
  );
end;
$$;

-- Vector search RPC for strict RAG
create or replace function gob_search_chunks(
  p_workspace_id uuid,
  p_query_embedding text,
  p_match_count integer default 10,
  p_min_similarity double precision default 0.25
)
returns table (
  chunk_id uuid,
  content text,
  similarity double precision,
  source_url text,
  snapshot_id uuid,
  page integer,
  section text
)
language sql
stable
as $$
  with q as (
    select p_query_embedding::vector as v
  )
  select
    c.id as chunk_id,
    c.content,
    (1 - (c.embedding <=> q.v))::double precision as similarity,
    c.source_url,
    c.snapshot_id,
    c.page,
    c.section
  from gob_chunks c, q
  where c.workspace_id = p_workspace_id
    and c.embedding is not null
    and (1 - (c.embedding <=> q.v)) >= p_min_similarity
  order by (c.embedding <=> q.v) asc
  limit p_match_count;
$$;

-- Text search RPC (for hybrid retrieval and in-source search)
create or replace function gob_search_chunks_text(
  p_workspace_id uuid,
  p_query_text text,
  p_match_count integer default 10
)
returns table (
  chunk_id uuid,
  content text,
  rank double precision,
  source_url text,
  snapshot_id uuid,
  page integer,
  section text
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.content,
    ts_rank_cd(
      to_tsvector('spanish', coalesce(c.content, '')),
      websearch_to_tsquery('spanish', coalesce(p_query_text, ''))
    )::double precision as rank,
    c.source_url,
    c.snapshot_id,
    c.page,
    c.section
  from gob_chunks c
  where c.workspace_id = p_workspace_id
    and length(trim(coalesce(p_query_text, ''))) > 0
    and to_tsvector('spanish', coalesce(c.content, '')) @@ websearch_to_tsquery('spanish', coalesce(p_query_text, ''))
  order by rank desc
  limit p_match_count;
$$;

-- Retrieval traces (diagnostics and audit for RAG quality)
create table if not exists gob_rag_retrieval_traces (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  created_by uuid references auth.users(id),
  stage text not null check (stage in ('chat', 'report', 'search', 'debug')),
  provider text not null check (provider in ('local', 'openai', 'hybrid')),
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  results jsonb not null default '[]'::jsonb,
  response_id text,
  model text,
  thread_id uuid references gob_chat_threads(id) on delete set null,
  message_id uuid references gob_chat_messages(id) on delete set null,
  report_id uuid references gob_reports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_rag_retrieval_traces_ws_idx on gob_rag_retrieval_traces(workspace_id, created_at desc);
create index if not exists gob_rag_retrieval_traces_report_idx on gob_rag_retrieval_traces(report_id, created_at desc);
create index if not exists gob_rag_retrieval_traces_thread_idx on gob_rag_retrieval_traces(thread_id, created_at desc);

-- =========================================================
-- Audit + Alerts
-- =========================================================

create table if not exists gob_audit_logs (
  id uuid default gen_random_uuid() primary key,
  timestamp timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid references auth.users(id),
  action text not null,
  target_resource text,
  details jsonb default '{}'::jsonb
);

create index if not exists gob_audit_logs_ts_idx on gob_audit_logs(timestamp desc);

create table if not exists gob_alerts (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  workspace_id uuid references gob_workspaces(id) on delete cascade,
  watchlist_id uuid references gob_excel_watchlists(id) on delete cascade,
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  is_read boolean not null default false,
  metadata jsonb default '{}'::jsonb
);

-- =========================================================
-- RLS
-- =========================================================

alter table gob_workspaces enable row level security;
alter table gob_workspace_members enable row level security;
alter table gob_workspace_profiles enable row level security;
alter table gob_workspace_parties enable row level security;
alter table gob_workspace_timeline_events enable row level security;
alter table gob_workspace_timeline_event_snapshots enable row level security;
alter table gob_workspace_invites enable row level security;
alter table gob_knowledge_bases enable row level security;
alter table gob_sources enable row level security;
alter table gob_source_snapshots enable row level security;
alter table gob_chunks enable row level security;
alter table gob_chat_threads enable row level security;
alter table gob_chat_messages enable row level security;
alter table gob_notes enable row level security;
alter table gob_reports enable row level security;
alter table gob_report_versions enable row level security;
alter table gob_oauth_connections enable row level security;
alter table gob_oauth_states enable row level security;
alter table gob_excel_watchlists enable row level security;
alter table gob_excel_runs enable row level security;
alter table gob_email_runs enable row level security;
alter table gob_workers enable row level security;
alter table gob_alerts enable row level security;
alter table gob_audit_logs enable row level security;
alter table gob_rag_retrieval_traces enable row level security;

-- Workspaces
drop policy if exists "workspaces_select" on gob_workspaces;
create policy "workspaces_select" on gob_workspaces
  for select
  using (gob_is_workspace_member(id));

drop policy if exists "workspaces_insert" on gob_workspaces;
create policy "workspaces_insert" on gob_workspaces
  for insert
  to authenticated
  with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists "workspaces_update_admin" on gob_workspaces;
create policy "workspaces_update_admin" on gob_workspaces
  for update
  using (gob_is_workspace_admin(id));

-- Members
drop policy if exists "members_select" on gob_workspace_members;
create policy "members_select" on gob_workspace_members
  for select
  using (gob_is_workspace_member(workspace_id));

drop policy if exists "members_insert_admin" on gob_workspace_members;
create policy "members_insert_admin" on gob_workspace_members
  for insert
  with check (
    gob_is_workspace_admin(workspace_id)
    or (
      auth.uid() = user_id
      and exists(
        select 1
        from gob_workspaces w
        where w.id = workspace_id
          and w.created_by = auth.uid()
      )
    )
  );

drop policy if exists "members_update_admin" on gob_workspace_members;
create policy "members_update_admin" on gob_workspace_members
  for update
  using (gob_is_workspace_admin(workspace_id));

drop policy if exists "members_delete_admin" on gob_workspace_members;
create policy "members_delete_admin" on gob_workspace_members
  for delete
  using (gob_is_workspace_admin(workspace_id));

-- Workspace profile (expediente metadata)
drop policy if exists "profiles_select" on gob_workspace_profiles;
create policy "profiles_select" on gob_workspace_profiles
  for select
  using (gob_is_workspace_member(workspace_id));

drop policy if exists "profiles_insert" on gob_workspace_profiles;
create policy "profiles_insert" on gob_workspace_profiles
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "profiles_update" on gob_workspace_profiles;
create policy "profiles_update" on gob_workspace_profiles
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "profiles_delete" on gob_workspace_profiles;
create policy "profiles_delete" on gob_workspace_profiles
  for delete
  using (gob_is_workspace_admin(workspace_id));

-- Parties / actors
drop policy if exists "parties_select" on gob_workspace_parties;
create policy "parties_select" on gob_workspace_parties
  for select
  using (gob_is_workspace_member(workspace_id));

drop policy if exists "parties_insert" on gob_workspace_parties;
create policy "parties_insert" on gob_workspace_parties
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "parties_update" on gob_workspace_parties;
create policy "parties_update" on gob_workspace_parties
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "parties_delete" on gob_workspace_parties;
create policy "parties_delete" on gob_workspace_parties
  for delete
  using (gob_is_workspace_writer(workspace_id));

-- Timeline events
drop policy if exists "timeline_select" on gob_workspace_timeline_events;
create policy "timeline_select" on gob_workspace_timeline_events
  for select
  using (gob_is_workspace_member(workspace_id));

drop policy if exists "timeline_insert" on gob_workspace_timeline_events;
create policy "timeline_insert" on gob_workspace_timeline_events
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "timeline_update" on gob_workspace_timeline_events;
create policy "timeline_update" on gob_workspace_timeline_events
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "timeline_delete" on gob_workspace_timeline_events;
create policy "timeline_delete" on gob_workspace_timeline_events
  for delete
  using (gob_is_workspace_writer(workspace_id));

-- Timeline event -> snapshot links
drop policy if exists "timeline_snapshots_select" on gob_workspace_timeline_event_snapshots;
create policy "timeline_snapshots_select" on gob_workspace_timeline_event_snapshots
  for select
  using (
    exists (
      select 1
      from gob_workspace_timeline_events e
      where e.id = event_id
        and gob_is_workspace_member(e.workspace_id)
    )
  );

drop policy if exists "timeline_snapshots_insert" on gob_workspace_timeline_event_snapshots;
create policy "timeline_snapshots_insert" on gob_workspace_timeline_event_snapshots
  for insert
  with check (
    exists (
      select 1
      from gob_workspace_timeline_events e
      join gob_source_snapshots s on s.id = snapshot_id
      where e.id = event_id
        and e.workspace_id = s.workspace_id
        and gob_is_workspace_writer(e.workspace_id)
    )
  );

drop policy if exists "timeline_snapshots_delete" on gob_workspace_timeline_event_snapshots;
create policy "timeline_snapshots_delete" on gob_workspace_timeline_event_snapshots
  for delete
  using (
    exists (
      select 1
      from gob_workspace_timeline_events e
      join gob_source_snapshots s on s.id = snapshot_id
      where e.id = event_id
        and e.workspace_id = s.workspace_id
        and gob_is_workspace_writer(e.workspace_id)
    )
  );

-- Workspace invites (admin-only)
drop policy if exists "invites_select" on gob_workspace_invites;
create policy "invites_select" on gob_workspace_invites
  for select
  using (gob_is_workspace_admin(workspace_id));

drop policy if exists "invites_insert" on gob_workspace_invites;
create policy "invites_insert" on gob_workspace_invites
  for insert
  with check (gob_is_workspace_admin(workspace_id));

drop policy if exists "invites_update" on gob_workspace_invites;
create policy "invites_update" on gob_workspace_invites
  for update
  using (gob_is_workspace_admin(workspace_id));

drop policy if exists "invites_delete" on gob_workspace_invites;
create policy "invites_delete" on gob_workspace_invites
  for delete
  using (gob_is_workspace_admin(workspace_id));

-- Workspace-scoped tables (select for members)
drop policy if exists "knowledge_bases_select" on gob_knowledge_bases;
create policy "knowledge_bases_select" on gob_knowledge_bases
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "knowledge_bases_insert" on gob_knowledge_bases;
create policy "knowledge_bases_insert" on gob_knowledge_bases
  for insert
  with check (gob_is_workspace_admin(workspace_id));

drop policy if exists "knowledge_bases_update" on gob_knowledge_bases;
create policy "knowledge_bases_update" on gob_knowledge_bases
  for update
  using (gob_is_workspace_admin(workspace_id));

drop policy if exists "knowledge_bases_delete" on gob_knowledge_bases;
create policy "knowledge_bases_delete" on gob_knowledge_bases
  for delete
  using (gob_is_workspace_admin(workspace_id));

drop policy if exists "sources_select" on gob_sources;
create policy "sources_select" on gob_sources
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "sources_write" on gob_sources;
drop policy if exists "sources_insert" on gob_sources;
create policy "sources_insert" on gob_sources
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "sources_update" on gob_sources;
create policy "sources_update" on gob_sources
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "sources_delete" on gob_sources;
create policy "sources_delete" on gob_sources
  for delete
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "snapshots_select" on gob_source_snapshots;
create policy "snapshots_select" on gob_source_snapshots
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "snapshots_write" on gob_source_snapshots;
drop policy if exists "snapshots_insert" on gob_source_snapshots;
create policy "snapshots_insert" on gob_source_snapshots
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "snapshots_update" on gob_source_snapshots;
create policy "snapshots_update" on gob_source_snapshots
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "snapshots_delete" on gob_source_snapshots;
create policy "snapshots_delete" on gob_source_snapshots
  for delete
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "chunks_select" on gob_chunks;
create policy "chunks_select" on gob_chunks
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "chunks_write" on gob_chunks;
-- No user writes to chunks; worker uses service role (bypasses RLS)

drop policy if exists "rag_traces_select" on gob_rag_retrieval_traces;
create policy "rag_traces_select" on gob_rag_retrieval_traces
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "rag_traces_insert" on gob_rag_retrieval_traces;
create policy "rag_traces_insert" on gob_rag_retrieval_traces
  for insert
  with check (
    gob_is_workspace_writer(workspace_id)
    and (created_by is null or created_by = auth.uid())
  );

drop policy if exists "rag_traces_delete" on gob_rag_retrieval_traces;
create policy "rag_traces_delete" on gob_rag_retrieval_traces
  for delete
  using (gob_is_workspace_admin(workspace_id));

-- Chat threads
drop policy if exists "threads_select" on gob_chat_threads;
create policy "threads_select" on gob_chat_threads
  for select
  using (gob_is_workspace_member(workspace_id));

drop policy if exists "threads_insert" on gob_chat_threads;
create policy "threads_insert" on gob_chat_threads
  for insert
  with check (
    gob_is_workspace_writer(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists "threads_update" on gob_chat_threads;
create policy "threads_update" on gob_chat_threads
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "threads_delete" on gob_chat_threads;
create policy "threads_delete" on gob_chat_threads
  for delete
  using (gob_is_workspace_admin(workspace_id));

drop policy if exists "chat_select" on gob_chat_messages;
create policy "chat_select" on gob_chat_messages
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "chat_write" on gob_chat_messages;
create policy "chat_write" on gob_chat_messages
  for insert
  with check (
    gob_is_workspace_writer(workspace_id)
    and (
      thread_id is null
      or exists(
        select 1
        from gob_chat_threads t
        where t.id = thread_id
          and t.workspace_id = workspace_id
      )
    )
  );

drop policy if exists "notes_select" on gob_notes;
create policy "notes_select" on gob_notes
  for select
  using (
    gob_is_workspace_member(workspace_id)
    and (visibility = 'shared' or created_by = auth.uid())
  );

drop policy if exists "notes_write" on gob_notes;
create policy "notes_write" on gob_notes
  for insert
  with check (
    gob_is_workspace_writer(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists "notes_update" on gob_notes;
create policy "notes_update" on gob_notes
  for update
  using (
    gob_is_workspace_writer(workspace_id)
    and (visibility = 'shared' or created_by = auth.uid())
  );

drop policy if exists "notes_delete" on gob_notes;
create policy "notes_delete" on gob_notes
  for delete
  using (
    gob_is_workspace_writer(workspace_id)
    and (visibility = 'shared' or created_by = auth.uid())
  );

drop policy if exists "reports_select" on gob_reports;
create policy "reports_select" on gob_reports
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "reports_write" on gob_reports;
create policy "reports_write" on gob_reports
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "reports_update" on gob_reports;
create policy "reports_update" on gob_reports
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "reports_delete" on gob_reports;
create policy "reports_delete" on gob_reports
  for delete
  using (gob_is_workspace_writer(workspace_id));

-- Report versions
drop policy if exists "report_versions_select" on gob_report_versions;
create policy "report_versions_select" on gob_report_versions
  for select
  using (gob_is_workspace_member(workspace_id));

drop policy if exists "report_versions_insert" on gob_report_versions;
create policy "report_versions_insert" on gob_report_versions
  for insert
  with check (
    gob_is_workspace_writer(workspace_id)
    and created_by = auth.uid()
  );

-- OAuth connections (user-only)
drop policy if exists "oauth_connections_user" on gob_oauth_connections;
create policy "oauth_connections_user" on gob_oauth_connections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "oauth_states_user" on gob_oauth_states;
create policy "oauth_states_user" on gob_oauth_states
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Excel watchlists (workspace members)
drop policy if exists "watchlists_select" on gob_excel_watchlists;
create policy "watchlists_select" on gob_excel_watchlists
  for select using (gob_is_workspace_member(workspace_id));

drop policy if exists "watchlists_write" on gob_excel_watchlists;
create policy "watchlists_write" on gob_excel_watchlists
  for insert
  with check (gob_is_workspace_writer(workspace_id));

drop policy if exists "watchlists_update" on gob_excel_watchlists;
create policy "watchlists_update" on gob_excel_watchlists
  for update
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "watchlists_delete" on gob_excel_watchlists;
create policy "watchlists_delete" on gob_excel_watchlists
  for delete
  using (gob_is_workspace_writer(workspace_id));

drop policy if exists "excel_runs_select" on gob_excel_runs;
create policy "excel_runs_select" on gob_excel_runs
  for select
  using (
    exists (
      select 1
      from gob_excel_watchlists w
      where w.id = watchlist_id
        and gob_is_workspace_member(w.workspace_id)
    )
  );

drop policy if exists "email_runs_select" on gob_email_runs;
create policy "email_runs_select" on gob_email_runs
  for select
  using (
    exists (
      select 1
      from gob_excel_watchlists w
      where w.id = watchlist_id
        and gob_is_workspace_member(w.workspace_id)
    )
  );

-- Alerts (workspace members)
drop policy if exists "alerts_select" on gob_alerts;
create policy "alerts_select" on gob_alerts
  for select using (workspace_id is null or gob_is_workspace_member(workspace_id));

drop policy if exists "alerts_write" on gob_alerts;
create policy "alerts_write" on gob_alerts
  for all
  using (workspace_id is null or gob_is_workspace_member(workspace_id))
  with check (workspace_id is null or gob_is_workspace_member(workspace_id));

-- Audit logs (workspace members only; broad by default)
drop policy if exists "audit_select" on gob_audit_logs;
create policy "audit_select" on gob_audit_logs
  for select using (auth.role() = 'authenticated');

drop policy if exists "audit_insert" on gob_audit_logs;
create policy "audit_insert" on gob_audit_logs
  for insert with check (auth.role() = 'authenticated');

-- Jobs: no policies (service role bypasses RLS)
alter table gob_jobs enable row level security;

-- Workers: readable for authenticated (ops UI)
drop policy if exists "workers_select" on gob_workers;
create policy "workers_select" on gob_workers
  for select
  using (auth.role() = 'authenticated');
