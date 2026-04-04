-- Legal GraphRAG foundation for tribunal causes, entities, and relations

create table if not exists gob_entities (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  scope_key text not null default 'workspace',
  snapshot_id uuid references gob_source_snapshots(id) on delete cascade,
  source_id uuid references gob_sources(id) on delete cascade,
  cause_id uuid references gob_tribunal_causes(id) on delete cascade,
  entity_type text not null,
  entity_value text not null,
  normalized_value text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists gob_entities_unique_norm_idx
  on gob_entities(workspace_id, scope_key, entity_type, normalized_value);
create index if not exists gob_entities_workspace_idx on gob_entities(workspace_id, entity_type);
create index if not exists gob_entities_cause_idx on gob_entities(cause_id);

create table if not exists gob_entity_relations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  snapshot_id uuid references gob_source_snapshots(id) on delete cascade,
  source_entity_id uuid references gob_entities(id) on delete cascade not null,
  target_entity_id uuid references gob_entities(id) on delete cascade not null,
  relation_type text not null,
  weight double precision not null default 1.0,
  evidence_chunk_id uuid references gob_chunks(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint gob_entity_relations_no_self_ref check (source_entity_id <> target_entity_id)
);

create unique index if not exists gob_entity_relations_unique_idx
  on gob_entity_relations(source_entity_id, target_entity_id, relation_type, coalesce(evidence_chunk_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists gob_entity_relations_workspace_idx on gob_entity_relations(workspace_id, relation_type);
create index if not exists gob_entity_relations_source_idx on gob_entity_relations(source_entity_id);
create index if not exists gob_entity_relations_target_idx on gob_entity_relations(target_entity_id);

create table if not exists gob_cause_similarity (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references gob_workspaces(id) on delete cascade not null,
  cause_a_id uuid references gob_tribunal_causes(id) on delete cascade not null,
  cause_b_id uuid references gob_tribunal_causes(id) on delete cascade not null,
  cause_a_rol text,
  cause_b_rol text,
  similarity_score double precision not null,
  shared_factors jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint gob_cause_similarity_distinct check (cause_a_id <> cause_b_id)
);

create unique index if not exists gob_cause_similarity_unique_idx
  on gob_cause_similarity(workspace_id, least(cause_a_id, cause_b_id), greatest(cause_a_id, cause_b_id));
create index if not exists gob_cause_similarity_score_idx on gob_cause_similarity(workspace_id, similarity_score desc);

alter table gob_entities enable row level security;
alter table gob_entity_relations enable row level security;
alter table gob_cause_similarity enable row level security;

drop policy if exists "entities_select" on gob_entities;
create policy "entities_select" on gob_entities
  for select
  to authenticated
  using (
    exists (
      select 1
      from gob_workspace_members m
      where m.workspace_id = gob_entities.workspace_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "entity_relations_select" on gob_entity_relations;
create policy "entity_relations_select" on gob_entity_relations
  for select
  to authenticated
  using (
    exists (
      select 1
      from gob_workspace_members m
      where m.workspace_id = gob_entity_relations.workspace_id
        and m.user_id = auth.uid()
    )
  );

drop policy if exists "cause_similarity_select" on gob_cause_similarity;
create policy "cause_similarity_select" on gob_cause_similarity
  for select
  to authenticated
  using (
    exists (
      select 1
      from gob_workspace_members m
      where m.workspace_id = gob_cause_similarity.workspace_id
        and m.user_id = auth.uid()
    )
  );

grant select on public.gob_entities to authenticated;
grant select on public.gob_entity_relations to authenticated;
grant select on public.gob_cause_similarity to authenticated;
