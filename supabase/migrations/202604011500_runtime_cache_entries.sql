create table if not exists gob_runtime_cache_entries (
  cache_key text primary key,
  namespace text not null,
  value jsonb not null,
  expires_at timestamp with time zone not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists gob_runtime_cache_entries_namespace_idx on gob_runtime_cache_entries(namespace);
create index if not exists gob_runtime_cache_entries_expires_idx on gob_runtime_cache_entries(expires_at);
