-- =========================================================
-- Cuaderno Ambiental (Tribunal Ambiental Chile)
-- Verificacion de esquema / RLS / policies / buckets (+ grants basicos)
--
-- Uso:
-- 1) Ejecuta primero `supabase_schema.sql`.
-- 2) Ejecuta este archivo en el SQL editor de Supabase.
--
-- Si algo falta, este script levanta EXCEPTION.
-- =========================================================

do $$
declare
  t text;
  fn text;
begin
  -- Extensions
  if not exists(select 1 from pg_extension where extname = 'pgcrypto') then
    raise exception 'Missing extension: pgcrypto';
  end if;

  if not exists(select 1 from pg_extension where extname = 'vector') then
    raise exception 'Missing extension: vector (pgvector)';
  end if;

  -- Tables
  for t in
    select unnest(array[
      'gob_workspaces',
      'gob_workspace_members',
      'gob_workspace_profiles',
      'gob_workspace_parties',
      'gob_workspace_timeline_events',
      'gob_workspace_timeline_event_snapshots',
      'gob_workspace_invites',
      'gob_knowledge_bases',
      'gob_sources',
      'gob_source_snapshots',
      'gob_chunks',
      'gob_chat_threads',
      'gob_chat_messages',
      'gob_notes',
      'gob_reports',
      'gob_report_versions',
      'gob_oauth_connections',
      'gob_oauth_states',
      'gob_excel_watchlists',
      'gob_excel_runs',
      'gob_email_runs',
      'gob_jobs',
      'gob_workers',
      'gob_alerts',
      'gob_audit_logs',
      'gob_rag_retrieval_traces'
    ])
  loop
    if not exists(
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = t
    ) then
      raise exception 'Missing table: %', t;
    end if;
  end loop;

  -- RLS enabled
  for t in
    select unnest(array[
      'gob_workspaces',
      'gob_workspace_members',
      'gob_workspace_profiles',
      'gob_workspace_parties',
      'gob_workspace_timeline_events',
      'gob_workspace_timeline_event_snapshots',
      'gob_workspace_invites',
      'gob_knowledge_bases',
      'gob_sources',
      'gob_source_snapshots',
      'gob_chunks',
      'gob_chat_threads',
      'gob_chat_messages',
      'gob_notes',
      'gob_reports',
      'gob_report_versions',
      'gob_oauth_connections',
      'gob_oauth_states',
      'gob_excel_watchlists',
      'gob_excel_runs',
      'gob_email_runs',
      'gob_jobs',
      'gob_workers',
      'gob_alerts',
      'gob_audit_logs',
      'gob_rag_retrieval_traces'
    ])
  loop
    if not exists(
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = t
        and c.relrowsecurity
    ) then
      raise exception 'RLS not enabled: %', t;
    end if;
  end loop;

  -- Policies
  -- Workspaces
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspaces' and policyname='workspaces_select') then
    raise exception 'Missing policy: gob_workspaces.workspaces_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspaces' and policyname='workspaces_insert') then
    raise exception 'Missing policy: gob_workspaces.workspaces_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspaces' and policyname='workspaces_update_admin') then
    raise exception 'Missing policy: gob_workspaces.workspaces_update_admin';
  end if;

  -- Members
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_members' and policyname='members_select') then
    raise exception 'Missing policy: gob_workspace_members.members_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_members' and policyname='members_insert_admin') then
    raise exception 'Missing policy: gob_workspace_members.members_insert_admin';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_members' and policyname='members_update_admin') then
    raise exception 'Missing policy: gob_workspace_members.members_update_admin';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_members' and policyname='members_delete_admin') then
    raise exception 'Missing policy: gob_workspace_members.members_delete_admin';
  end if;

  -- Profile
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_profiles' and policyname='profiles_select') then
    raise exception 'Missing policy: gob_workspace_profiles.profiles_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_profiles' and policyname='profiles_insert') then
    raise exception 'Missing policy: gob_workspace_profiles.profiles_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_profiles' and policyname='profiles_update') then
    raise exception 'Missing policy: gob_workspace_profiles.profiles_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_profiles' and policyname='profiles_delete') then
    raise exception 'Missing policy: gob_workspace_profiles.profiles_delete';
  end if;

  -- Parties
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_parties' and policyname='parties_select') then
    raise exception 'Missing policy: gob_workspace_parties.parties_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_parties' and policyname='parties_insert') then
    raise exception 'Missing policy: gob_workspace_parties.parties_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_parties' and policyname='parties_update') then
    raise exception 'Missing policy: gob_workspace_parties.parties_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_parties' and policyname='parties_delete') then
    raise exception 'Missing policy: gob_workspace_parties.parties_delete';
  end if;

  -- Timeline
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_events' and policyname='timeline_select') then
    raise exception 'Missing policy: gob_workspace_timeline_events.timeline_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_events' and policyname='timeline_insert') then
    raise exception 'Missing policy: gob_workspace_timeline_events.timeline_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_events' and policyname='timeline_update') then
    raise exception 'Missing policy: gob_workspace_timeline_events.timeline_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_events' and policyname='timeline_delete') then
    raise exception 'Missing policy: gob_workspace_timeline_events.timeline_delete';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_event_snapshots' and policyname='timeline_snapshots_select') then
    raise exception 'Missing policy: gob_workspace_timeline_event_snapshots.timeline_snapshots_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_event_snapshots' and policyname='timeline_snapshots_insert') then
    raise exception 'Missing policy: gob_workspace_timeline_event_snapshots.timeline_snapshots_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_timeline_event_snapshots' and policyname='timeline_snapshots_delete') then
    raise exception 'Missing policy: gob_workspace_timeline_event_snapshots.timeline_snapshots_delete';
  end if;

  -- Invites
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_invites' and policyname='invites_select') then
    raise exception 'Missing policy: gob_workspace_invites.invites_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_invites' and policyname='invites_insert') then
    raise exception 'Missing policy: gob_workspace_invites.invites_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_invites' and policyname='invites_update') then
    raise exception 'Missing policy: gob_workspace_invites.invites_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workspace_invites' and policyname='invites_delete') then
    raise exception 'Missing policy: gob_workspace_invites.invites_delete';
  end if;

  -- Knowledge bases
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_knowledge_bases' and policyname='knowledge_bases_select') then
    raise exception 'Missing policy: gob_knowledge_bases.knowledge_bases_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_knowledge_bases' and policyname='knowledge_bases_insert') then
    raise exception 'Missing policy: gob_knowledge_bases.knowledge_bases_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_knowledge_bases' and policyname='knowledge_bases_update') then
    raise exception 'Missing policy: gob_knowledge_bases.knowledge_bases_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_knowledge_bases' and policyname='knowledge_bases_delete') then
    raise exception 'Missing policy: gob_knowledge_bases.knowledge_bases_delete';
  end if;

  -- Sources/Snapshots/Chunks
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_sources' and policyname='sources_select') then
    raise exception 'Missing policy: gob_sources.sources_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_sources' and policyname='sources_insert') then
    raise exception 'Missing policy: gob_sources.sources_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_sources' and policyname='sources_update') then
    raise exception 'Missing policy: gob_sources.sources_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_sources' and policyname='sources_delete') then
    raise exception 'Missing policy: gob_sources.sources_delete';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_source_snapshots' and policyname='snapshots_select') then
    raise exception 'Missing policy: gob_source_snapshots.snapshots_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_source_snapshots' and policyname='snapshots_insert') then
    raise exception 'Missing policy: gob_source_snapshots.snapshots_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_source_snapshots' and policyname='snapshots_update') then
    raise exception 'Missing policy: gob_source_snapshots.snapshots_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_source_snapshots' and policyname='snapshots_delete') then
    raise exception 'Missing policy: gob_source_snapshots.snapshots_delete';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chunks' and policyname='chunks_select') then
    raise exception 'Missing policy: gob_chunks.chunks_select';
  end if;

  -- Retrieval traces
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_rag_retrieval_traces' and policyname='rag_traces_select') then
    raise exception 'Missing policy: gob_rag_retrieval_traces.rag_traces_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_rag_retrieval_traces' and policyname='rag_traces_insert') then
    raise exception 'Missing policy: gob_rag_retrieval_traces.rag_traces_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_rag_retrieval_traces' and policyname='rag_traces_delete') then
    raise exception 'Missing policy: gob_rag_retrieval_traces.rag_traces_delete';
  end if;

  -- Threads + Chat
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chat_threads' and policyname='threads_select') then
    raise exception 'Missing policy: gob_chat_threads.threads_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chat_threads' and policyname='threads_insert') then
    raise exception 'Missing policy: gob_chat_threads.threads_insert';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chat_threads' and policyname='threads_update') then
    raise exception 'Missing policy: gob_chat_threads.threads_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chat_threads' and policyname='threads_delete') then
    raise exception 'Missing policy: gob_chat_threads.threads_delete';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chat_messages' and policyname='chat_select') then
    raise exception 'Missing policy: gob_chat_messages.chat_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_chat_messages' and policyname='chat_write') then
    raise exception 'Missing policy: gob_chat_messages.chat_write';
  end if;

  -- Notes
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_notes' and policyname='notes_select') then
    raise exception 'Missing policy: gob_notes.notes_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_notes' and policyname='notes_write') then
    raise exception 'Missing policy: gob_notes.notes_write';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_notes' and policyname='notes_update') then
    raise exception 'Missing policy: gob_notes.notes_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_notes' and policyname='notes_delete') then
    raise exception 'Missing policy: gob_notes.notes_delete';
  end if;

  -- Reports
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_reports' and policyname='reports_select') then
    raise exception 'Missing policy: gob_reports.reports_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_reports' and policyname='reports_write') then
    raise exception 'Missing policy: gob_reports.reports_write';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_reports' and policyname='reports_update') then
    raise exception 'Missing policy: gob_reports.reports_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_reports' and policyname='reports_delete') then
    raise exception 'Missing policy: gob_reports.reports_delete';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_report_versions' and policyname='report_versions_select') then
    raise exception 'Missing policy: gob_report_versions.report_versions_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_report_versions' and policyname='report_versions_insert') then
    raise exception 'Missing policy: gob_report_versions.report_versions_insert';
  end if;

  -- OAuth
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_oauth_connections' and policyname='oauth_connections_user') then
    raise exception 'Missing policy: gob_oauth_connections.oauth_connections_user';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_oauth_states' and policyname='oauth_states_user') then
    raise exception 'Missing policy: gob_oauth_states.oauth_states_user';
  end if;

  -- Watchlists + runs
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_excel_watchlists' and policyname='watchlists_select') then
    raise exception 'Missing policy: gob_excel_watchlists.watchlists_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_excel_watchlists' and policyname='watchlists_write') then
    raise exception 'Missing policy: gob_excel_watchlists.watchlists_write';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_excel_watchlists' and policyname='watchlists_update') then
    raise exception 'Missing policy: gob_excel_watchlists.watchlists_update';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_excel_watchlists' and policyname='watchlists_delete') then
    raise exception 'Missing policy: gob_excel_watchlists.watchlists_delete';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_excel_runs' and policyname='excel_runs_select') then
    raise exception 'Missing policy: gob_excel_runs.excel_runs_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_email_runs' and policyname='email_runs_select') then
    raise exception 'Missing policy: gob_email_runs.email_runs_select';
  end if;

  -- Alerts + Audit
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_alerts' and policyname='alerts_select') then
    raise exception 'Missing policy: gob_alerts.alerts_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_alerts' and policyname='alerts_write') then
    raise exception 'Missing policy: gob_alerts.alerts_write';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_audit_logs' and policyname='audit_select') then
    raise exception 'Missing policy: gob_audit_logs.audit_select';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_audit_logs' and policyname='audit_insert') then
    raise exception 'Missing policy: gob_audit_logs.audit_insert';
  end if;

  if not exists(select 1 from pg_policies where schemaname='public' and tablename='gob_workers' and policyname='workers_select') then
    raise exception 'Missing policy: gob_workers.workers_select';
  end if;

  -- Functions
  for fn in
    select unnest(array[
      'gob_is_workspace_member',
      'gob_is_workspace_admin',
      'gob_is_workspace_writer',
      'gob_claim_jobs',
      'gob_search_chunks',
      'gob_search_chunks_text',
      'gob_list_jobs_for_workspace',
      'gob_retention_cleanup'
    ])
  loop
    if not exists(
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn
    ) then
      raise exception 'Missing function: %', fn;
    end if;
  end loop;

  -- Basic grants (authenticated)
  if not has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'Missing grant: USAGE on schema public for role authenticated';
  end if;

  for t in
    select unnest(array[
      'gob_workspaces',
      'gob_workspace_members',
      'gob_workspace_profiles',
      'gob_workspace_parties',
      'gob_workspace_timeline_events',
      'gob_workspace_timeline_event_snapshots',
      'gob_workspace_invites',
      'gob_sources',
      'gob_source_snapshots',
      'gob_chunks',
      'gob_chat_threads',
      'gob_chat_messages',
      'gob_notes',
      'gob_reports',
      'gob_report_versions',
      'gob_excel_watchlists',
      'gob_excel_runs',
      'gob_email_runs',
      'gob_oauth_connections',
      'gob_oauth_states',
      'gob_workers',
      'gob_alerts',
      'gob_audit_logs'
    ])
  loop
    if not has_table_privilege('authenticated', format('public.%I', t), 'SELECT') then
      raise exception 'Missing grant: SELECT on table public.% for role authenticated', t;
    end if;
  end loop;

  -- Storage buckets (requires Storage enabled)
  if not exists(select 1 from information_schema.schemata where schema_name = 'storage') then
    raise exception 'Missing schema: storage (habilita Supabase Storage)';
  end if;

  if not exists(select 1 from storage.buckets where id = 'gob_sources') then
    raise exception 'Missing Storage bucket: gob_sources';
  end if;
  if not exists(select 1 from storage.buckets where id = 'gob_excel') then
    raise exception 'Missing Storage bucket: gob_excel';
  end if;

  raise notice 'OK: schema verificado.';
end $$;
