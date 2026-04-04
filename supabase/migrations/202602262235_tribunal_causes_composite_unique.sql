-- Ensure tribunal causes are unique per tribunal + rol (not global rol)

do $$
begin
  if to_regclass('public.gob_tribunal_causes') is null then
    return;
  end if;

  -- Previous schema defined "rol" as globally unique.
  -- Drop that constraint so 1TA/2TA can share the same rol safely.
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'gob_tribunal_causes'
      and constraint_name = 'gob_tribunal_causes_rol_key'
      and constraint_type = 'UNIQUE'
  ) then
    alter table public.gob_tribunal_causes
      drop constraint gob_tribunal_causes_rol_key;
  end if;

  -- In some installs the unique index can remain.
  execute 'drop index if exists public.gob_tribunal_causes_rol_key';

  execute 'create unique index if not exists gob_tribunal_causes_tribunal_rol_uidx on public.gob_tribunal_causes(tribunal, rol)';
end;
$$;
