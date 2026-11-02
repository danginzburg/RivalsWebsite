-- Record highs for every stat category, from Rivals 5 onward.
--
-- Generated, never hand-edited: src/lib/server/records/rebuild.ts recomputes
-- the whole table from player_match_map_stats on every match import or edit
-- (the same hook that refreshes the live stat batches), so a re-import,
-- reassignment or deleted match can never leave a stale record behind.
--
-- Each row is one step in a category's progression. The current holder is the
-- row with superseded_at null; earlier rows are the record's history, kept so
-- the Hall of Fame can show who held it before and when it fell.

create table if not exists public.stat_records (
  id uuid primary key default gen_random_uuid(),
  -- Category key from src/lib/records/categories.ts ('kills', 'acs', 'map_margin', ...)
  category text not null,
  value double precision not null,
  holder_kind text not null check (holder_kind in ('player', 'team')),
  -- Who earned it. player_name/puuid are snapshots so an unlinked or renamed
  -- player still reads correctly; profile_id is the link when there is one.
  profile_id uuid references public.profiles(id) on delete set null,
  player_name text,
  puuid text,
  team_id uuid references public.teams(id) on delete set null,
  opponent_team_id uuid references public.teams(id) on delete set null,
  -- Where it happened.
  season_id uuid references public.seasons(id) on delete set null,
  match_id uuid not null references public.matches(id) on delete cascade,
  match_map_id uuid references public.match_maps(id) on delete cascade,
  player_match_map_stat_id bigint references public.player_match_map_stats(id) on delete cascade,
  map_name text,
  map_order smallint,
  agents text,
  stage text,
  achieved_at timestamptz,
  -- When a later performance beat it; null while it still stands.
  superseded_at timestamptz,
  superseded_by_value double precision,
  -- Later performances that equalled it without beating it. The first to reach
  -- a value holds the record.
  tie_count integer not null default 0,
  -- Snapshot of the performance around the record (K/D/A, rounds, map score).
  context jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create index if not exists stat_records_current_idx
  on public.stat_records (category)
  where superseded_at is null;
create index if not exists stat_records_profile_idx on public.stat_records (profile_id);
create index if not exists stat_records_team_idx on public.stat_records (team_id);
create index if not exists stat_records_match_idx on public.stat_records (match_id);

alter table public.stat_records enable row level security;

-- Records are public; writes go through the service role only.
drop policy if exists "stat_records_select" on public.stat_records;
create policy "stat_records_select" on public.stat_records
  for select using (true);

-- Swap the whole table in one transaction, so a reader never sees it half
-- rebuilt and two overlapping rebuilds cannot interleave their rows.
create or replace function public.replace_stat_records(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  lock table public.stat_records in exclusive mode;
  delete from public.stat_records where true;
  insert into public.stat_records (
    category, value, holder_kind,
    profile_id, player_name, puuid, team_id, opponent_team_id,
    season_id, match_id, match_map_id, player_match_map_stat_id,
    map_name, map_order, agents, stage, achieved_at,
    superseded_at, superseded_by_value, tie_count, context
  )
  select
    r.category, r.value, r.holder_kind,
    r.profile_id, r.player_name, r.puuid, r.team_id, r.opponent_team_id,
    r.season_id, r.match_id, r.match_map_id, r.player_match_map_stat_id,
    r.map_name, r.map_order, r.agents, r.stage, r.achieved_at,
    r.superseded_at, r.superseded_by_value, coalesce(r.tie_count, 0),
    coalesce(r.context, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    category text, value double precision, holder_kind text,
    profile_id uuid, player_name text, puuid text, team_id uuid, opponent_team_id uuid,
    season_id uuid, match_id uuid, match_map_id uuid, player_match_map_stat_id bigint,
    map_name text, map_order smallint, agents text, stage text, achieved_at timestamptz,
    superseded_at timestamptz, superseded_by_value double precision, tie_count integer,
    context jsonb
  );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

revoke all on function public.replace_stat_records(jsonb) from public, anon, authenticated;
