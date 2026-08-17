-- Rows that block 20260816_001_season_scoped_team_memberships.sql.
--
-- Rosters allow one active spot per player per season. These queries list the
-- players holding more than one in the same season, so the wrong row can be
-- closed (set is_active = false, left_at = <date>) before the unique indexes go
-- on. Run this against the live database if the migration raises.

-- 1. Same profile, two active spots in one season.
select
  tm.profile_id,
  coalesce(p.display_name, p.riot_id_base, p.email) as player,
  coalesce(s.name, '(no season)') as season,
  tm.id as membership_id,
  t.name as team,
  tm.role,
  tm.joined_at
from public.team_memberships tm
join public.teams t on t.id = tm.team_id
left join public.profiles p on p.id = tm.profile_id
left join public.seasons s on s.id = tm.season_id
where tm.is_active = true
  and tm.left_at is null
  and tm.profile_id is not null
  and (tm.profile_id, coalesce(tm.season_id, '00000000-0000-0000-0000-000000000000'::uuid)) in (
    select profile_id, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    from public.team_memberships
    where is_active = true and left_at is null and profile_id is not null
    group by profile_id, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    having count(*) > 1
  )
order by player, season, tm.joined_at;

-- 2. Same player name (the unlinked roster slots), two active spots in one season.
select
  tm.player_name,
  coalesce(s.name, '(no season)') as season,
  tm.id as membership_id,
  t.name as team,
  tm.role,
  tm.joined_at
from public.team_memberships tm
join public.teams t on t.id = tm.team_id
left join public.seasons s on s.id = tm.season_id
where tm.is_active = true
  and tm.left_at is null
  and tm.player_name is not null
  and (lower(tm.player_name), coalesce(tm.season_id, '00000000-0000-0000-0000-000000000000'::uuid)) in (
    select lower(player_name), coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    from public.team_memberships
    where is_active = true and left_at is null and player_name is not null
    group by lower(player_name), coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    having count(*) > 1
  )
order by tm.player_name, season, tm.joined_at;
