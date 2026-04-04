-- Improve lexical retrieval by indexing content + section + context summary

create index if not exists gob_chunks_context_tsv_idx on gob_chunks using gin (
  to_tsvector(
    'spanish',
    coalesce(content, '') ||
    ' ' ||
    coalesce(section, '') ||
    ' ' ||
    coalesce(metadata->>'context_summary', '')
  )
);

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
      to_tsvector(
        'spanish',
        coalesce(c.content, '') ||
        ' ' ||
        coalesce(c.section, '') ||
        ' ' ||
        coalesce(c.metadata->>'context_summary', '')
      ),
      websearch_to_tsquery('spanish', coalesce(p_query_text, ''))
    )::double precision as rank,
    c.source_url,
    c.snapshot_id,
    c.page,
    c.section
  from gob_chunks c
  where c.workspace_id = p_workspace_id
    and length(trim(coalesce(p_query_text, ''))) > 0
    and to_tsvector(
      'spanish',
      coalesce(c.content, '') ||
      ' ' ||
      coalesce(c.section, '') ||
      ' ' ||
      coalesce(c.metadata->>'context_summary', '')
    ) @@ websearch_to_tsquery('spanish', coalesce(p_query_text, ''))
  order by rank desc
  limit p_match_count;
$$;
