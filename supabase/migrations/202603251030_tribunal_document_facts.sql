-- Tribunal document facts layer for factual-first retrieval and strategic support

create table if not exists gob_tribunal_document_facts (
  document_id uuid primary key references gob_tribunal_documents(id) on delete cascade,
  cause_id uuid references gob_tribunal_causes(id) on delete cascade,
  rol text,
  doc_role text,
  source_id uuid references gob_sources(id) on delete set null,
  snapshot_id uuid references gob_source_snapshots(id) on delete set null,
  source_title text,
  document_type text,
  document_name text,
  document_url text,
  claimants text[] not null default '{}',
  fojas text[] not null default '{}',
  dates text[] not null default '{}',
  resolution_snippets text[] not null default '{}',
  key_signals text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_tribunal_document_facts_cause_idx on gob_tribunal_document_facts(cause_id);
create index if not exists gob_tribunal_document_facts_rol_idx on gob_tribunal_document_facts(rol, doc_role);
create index if not exists gob_tribunal_document_facts_snapshot_idx on gob_tribunal_document_facts(snapshot_id);

alter table gob_tribunal_document_facts enable row level security;

drop policy if exists "tribunal_document_facts_select" on gob_tribunal_document_facts;
create policy "tribunal_document_facts_select" on gob_tribunal_document_facts
  for select
  to authenticated
  using (true);

grant select on public.gob_tribunal_document_facts to authenticated;
