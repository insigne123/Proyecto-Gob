alter table gob_tribunal_document_facts
  add column if not exists cited_norms text[] not null default '{}',
  add column if not exists authorities text[] not null default '{}',
  add column if not exists outcome_signals text[] not null default '{}',
  add column if not exists holdings text[] not null default '{}';

create index if not exists gob_tribunal_document_facts_norms_gin on gob_tribunal_document_facts using gin (cited_norms);
create index if not exists gob_tribunal_document_facts_authorities_gin on gob_tribunal_document_facts using gin (authorities);
