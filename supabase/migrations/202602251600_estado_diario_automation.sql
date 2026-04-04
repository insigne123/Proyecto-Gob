-- Estado Diario 1TA automation + tribunal sync + digest

create table if not exists gob_estado_diario_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  fetched_at timestamp with time zone default timezone('utc'::text, now()) not null,
  tribunal text not null,
  daily_date date not null,
  status text not null default 'ok' check (status in ('ok', 'error')),
  is_signed boolean,
  entry_count integer not null default 0,
  hash text,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_estado_diario_runs_date_idx
  on gob_estado_diario_runs(tribunal, daily_date, fetched_at desc);
create index if not exists gob_estado_diario_runs_status_idx
  on gob_estado_diario_runs(status, fetched_at desc);
create unique index if not exists gob_estado_diario_runs_unique_hash_idx
  on gob_estado_diario_runs(tribunal, daily_date, hash)
  where hash is not null and status = 'ok';

create table if not exists gob_estado_diario_entries (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  run_id uuid references gob_estado_diario_runs(id) on delete cascade not null,
  tribunal text not null,
  daily_date date not null,
  line_no integer not null,
  rol text not null,
  id_causa_1ta text,
  caratula text,
  tipo text,
  providencias integer not null default 0,
  providencias_palabras text,
  rol_palabras text,
  is_digital boolean not null default false
);

create index if not exists gob_estado_diario_entries_run_idx
  on gob_estado_diario_entries(run_id, line_no);
create index if not exists gob_estado_diario_entries_daily_idx
  on gob_estado_diario_entries(daily_date, rol);
create unique index if not exists gob_estado_diario_entries_run_rol_uidx
  on gob_estado_diario_entries(run_id, rol);

create table if not exists gob_estado_diario_changes (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  run_id uuid references gob_estado_diario_runs(id) on delete cascade not null,
  tribunal text not null,
  daily_date date not null,
  rol text not null,
  id_causa_1ta text,
  caratula text,
  change_kind text not null check (change_kind in ('new_rol', 'providencias_up', 'providencias_down')),
  providencias_before integer,
  providencias_after integer,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_estado_diario_changes_date_idx
  on gob_estado_diario_changes(daily_date, rol);
create unique index if not exists gob_estado_diario_changes_run_rol_uidx
  on gob_estado_diario_changes(run_id, rol);

create table if not exists gob_tribunal_cause_updates (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  source text not null default 'estado_diario',
  source_date date,
  tribunal text not null,
  cause_id uuid,
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

create index if not exists gob_tribunal_cause_updates_date_idx
  on gob_tribunal_cause_updates(source_date, tribunal, rol);
create index if not exists gob_tribunal_cause_updates_cause_idx
  on gob_tribunal_cause_updates(cause_id, created_at desc);

do $$
begin
  if to_regclass('public.gob_tribunal_causes') is not null then
    if not exists (
      select 1
      from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = 'gob_tribunal_cause_updates'
        and constraint_type = 'FOREIGN KEY'
        and constraint_name = 'gob_tribunal_cause_updates_cause_fk'
    ) then
      alter table public.gob_tribunal_cause_updates
        add constraint gob_tribunal_cause_updates_cause_fk
        foreign key (cause_id) references public.gob_tribunal_causes(id) on delete cascade;
    end if;
  end if;
end;
$$;

create table if not exists gob_estado_diario_email_runs (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  daily_date date not null,
  recipients text[] not null default '{}',
  subject text not null,
  status text not null default 'sent' check (status in ('sent', 'error', 'skipped')),
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists gob_estado_diario_email_runs_date_idx
  on gob_estado_diario_email_runs(daily_date, created_at desc);

alter table if exists gob_tribunal_documents add column if not exists cod_asiento text;
alter table if exists gob_tribunal_documents add column if not exists cod_documento text;
alter table if exists gob_tribunal_documents add column if not exists source_origin text default 'legacy';
alter table if exists gob_tribunal_documents add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

do $$
begin
  if to_regclass('public.gob_tribunal_documents') is not null then
    execute 'create index if not exists gob_tribunal_documents_cod_documento_idx on public.gob_tribunal_documents(cod_documento)';
    execute 'create unique index if not exists gob_tribunal_documents_cause_asiento_uidx on public.gob_tribunal_documents(cause_id, cod_asiento) where cod_asiento is not null';
  end if;
end;
$$;

create or replace function gob_retention_cleanup(
  p_jobs_days integer default 30,
  p_excel_runs_days integer default 120,
  p_email_runs_days integer default 120,
  p_estado_diario_days integer default 180,
  p_cause_updates_days integer default 180
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
  v_estado_diario_runs integer := 0;
  v_estado_diario_email integer := 0;
  v_cause_updates integer := 0;
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

  delete from gob_estado_diario_runs
  where fetched_at < now() - make_interval(days => greatest(1, p_estado_diario_days));
  get diagnostics v_estado_diario_runs = row_count;

  delete from gob_estado_diario_email_runs
  where created_at < now() - make_interval(days => greatest(1, p_estado_diario_days));
  get diagnostics v_estado_diario_email = row_count;

  delete from gob_tribunal_cause_updates
  where created_at < now() - make_interval(days => greatest(1, p_cause_updates_days));
  get diagnostics v_cause_updates = row_count;

  return jsonb_build_object(
    'jobs', v_jobs,
    'excel_runs', v_excel,
    'email_runs', v_email,
    'estado_diario_runs', v_estado_diario_runs,
    'estado_diario_email_runs', v_estado_diario_email,
    'tribunal_cause_updates', v_cause_updates,
    'at', timezone('utc'::text, now())
  );
end;
$$;

alter table gob_estado_diario_runs enable row level security;
alter table gob_estado_diario_entries enable row level security;
alter table gob_estado_diario_changes enable row level security;
alter table gob_tribunal_cause_updates enable row level security;
alter table gob_estado_diario_email_runs enable row level security;

drop policy if exists "estado_diario_runs_select" on gob_estado_diario_runs;
create policy "estado_diario_runs_select" on gob_estado_diario_runs
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "estado_diario_entries_select" on gob_estado_diario_entries;
create policy "estado_diario_entries_select" on gob_estado_diario_entries
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "estado_diario_changes_select" on gob_estado_diario_changes;
create policy "estado_diario_changes_select" on gob_estado_diario_changes
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "tribunal_cause_updates_select" on gob_tribunal_cause_updates;
create policy "tribunal_cause_updates_select" on gob_tribunal_cause_updates
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "estado_diario_email_runs_select" on gob_estado_diario_email_runs;
create policy "estado_diario_email_runs_select" on gob_estado_diario_email_runs
  for select
  using (auth.role() = 'authenticated');

grant select on public.gob_estado_diario_runs to authenticated;
grant select on public.gob_estado_diario_entries to authenticated;
grant select on public.gob_estado_diario_changes to authenticated;
grant select on public.gob_tribunal_cause_updates to authenticated;
grant select on public.gob_estado_diario_email_runs to authenticated;
