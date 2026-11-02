-- Stat records are kept in separate tracks, so a side league's records never
-- mix with the Rivals ones.
--
--   'rivals'     every Rivals season from Season 5 on (the permanent records)
--   <season code> a single non-Rivals season (e.g. 'shitq1'), tracked while it
--                is the active season and shown on the Hall of Fame until then
--
-- Each track is rebuilt on its own, so replacing one never touches another.

alter table public.stat_records
  add column if not exists track text not null default 'rivals';

drop index if exists public.stat_records_current_idx;
create index if not exists stat_records_current_idx
  on public.stat_records (track, category)
  where superseded_at is null;

drop function if exists public.replace_stat_records(jsonb);

create or replace function public.replace_stat_records(p_track text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  lock table public.stat_records in exclusive mode;
  delete from public.stat_records where track = p_track;
  insert into public.stat_records (
    track, category, value, holder_kind,
    profile_id, player_name, puuid, team_id, opponent_team_id,
    season_id, match_id, match_map_id, player_match_map_stat_id,
    map_name, map_order, agents, stage, achieved_at,
    superseded_at, superseded_by_value, tie_count, context
  )
  select
    p_track, r.category, r.value, r.holder_kind,
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

revoke all on function public.replace_stat_records(text, jsonb) from public, anon, authenticated;
