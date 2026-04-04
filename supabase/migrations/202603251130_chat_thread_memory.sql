-- Persist lightweight thread memory for expert chat continuity

alter table if exists gob_chat_threads
  add column if not exists memory_summary text;

alter table if exists gob_chat_threads
  add column if not exists memory_role_tokens text[] not null default '{}';

alter table if exists gob_chat_threads
  add column if not exists memory_updated_at timestamp with time zone;
