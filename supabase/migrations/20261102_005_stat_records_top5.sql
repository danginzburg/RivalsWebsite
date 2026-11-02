-- Track the top 5 in every category instead of only the record holder.
--
-- stat_records now holds two kinds of row per category:
--   rank 1..5   the current top 5 (superseded_at null)
--   rank null   a past #1 that has since been beaten — the record's history
--
-- stat_record_overrides gains entry_key, so an edit can target one
-- performance in the top 5 rather than the whole category:
--   entry_key ''          category-wide: title, description, hide the category
--   entry_key <map:stat>  one performance: value/holder/team corrections, or
--                         hide it so the next performance moves up
-- A performance key names the match map and stat row, so a re-import (which
-- recreates both) leaves an old correction behind instead of misapplying it.

alter table public.stat_records add column if not exists rank smallint;

drop index if exists public.stat_records_current_idx;
create index if not exists stat_records_current_idx
  on public.stat_records (track, category, rank)
  where rank is not null;

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
    track, category, rank, value, holder_kind,
    profile_id, player_name, puuid, team_id, opponent_team_id,
    season_id, match_id, match_map_id, player_match_map_stat_id,
    map_name, map_order, agents, stage, achieved_at,
    superseded_at, superseded_by_value, tie_count, context
  )
  select
    p_track, r.category, r.rank, r.value, r.holder_kind,
    r.profile_id, r.player_name, r.puuid, r.team_id, r.opponent_team_id,
    r.season_id, r.match_id, r.match_map_id, r.player_match_map_stat_id,
    r.map_name, r.map_order, r.agents, r.stage, r.achieved_at,
    r.superseded_at, r.superseded_by_value, coalesce(r.tie_count, 0),
    coalesce(r.context, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
    category text, rank smallint, value double precision, holder_kind text,
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

-- Existing edits were made against the #1, which is the only entry they can
-- have meant: category-wide fields stay category-wide, and any correction
-- moves onto the performance it was pinned to.
alter table public.stat_record_overrides
  add column if not exists entry_key text not null default '';

-- What a performance looked like when it was edited ("44 kills · Player · Sunset"),
-- so a hidden one — which no longer appears in stat_records — can still be
-- named in the admin panel and brought back.
alter table public.stat_record_overrides add column if not exists label text;

alter table public.stat_record_overrides drop constraint if exists stat_record_overrides_pkey;
alter table public.stat_record_overrides add primary key (track, category, entry_key);

-- Moving old corrections only makes sense the first time through: once the
-- base_* columns are dropped below, a re-run skips straight past this.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stat_record_overrides'
      and column_name = 'base_match_map_id'
  ) then
    execute $sql$
      insert into public.stat_record_overrides (
        track, category, entry_key, value_text, unit, profile_id, player_name, team_id,
        updated_by_profile_id, updated_at
      )
      select
        o.track, o.category,
        r.match_map_id::text || ':' || coalesce(r.player_match_map_stat_id::text, ''),
        o.value_text, o.unit, o.profile_id, o.player_name, o.team_id,
        o.updated_by_profile_id, o.updated_at
      from public.stat_record_overrides o
      join public.stat_records r
        on r.track = o.track
       and r.category = o.category
       and r.match_map_id = o.base_match_map_id
       and r.superseded_at is null
      where o.entry_key = ''
        and (o.value_text is not null or o.unit is not null or o.profile_id is not null
             or o.player_name is not null or o.team_id is not null)
      on conflict (track, category, entry_key) do nothing
    $sql$;

    update public.stat_record_overrides
    set value_text = null, unit = null, profile_id = null, player_name = null, team_id = null
    where entry_key = '';
  end if;
end
$$;

alter table public.stat_record_overrides
  drop column if exists base_match_map_id,
  drop column if exists base_value;
