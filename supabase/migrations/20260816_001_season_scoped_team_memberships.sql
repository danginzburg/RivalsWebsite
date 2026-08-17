-- Season-scope team rosters so past seasons can be backfilled.
--
-- team_memberships enforced "one active roster spot per player, ever" via two
-- global partial unique indexes. That rule is right within a season and wrong
-- across them: a player on a current-season roster could never be added to the
-- team they actually played for two seasons ago, which is exactly what filling
-- in old seasons for the events page requires.
--
-- The season lives on teams and a unique index cannot reach through a join, so
-- the membership carries a denormalised copy that triggers keep honest.

alter table public.team_memberships
  add column if not exists season_id uuid references public.seasons(id) on delete set null;

update public.team_memberships tm
set season_id = t.season_id
from public.teams t
where tm.team_id = t.id
  and tm.season_id is distinct from t.season_id;

create index if not exists team_memberships_season_idx on public.team_memberships(season_id);

-- Callers insert with team_id alone; the season is derived here so no write path
-- can end up disagreeing with teams.season_id.
create or replace function public.sync_team_membership_season()
returns trigger
language plpgsql
as $$
begin
  select t.season_id into new.season_id
  from public.teams t
  where t.id = new.team_id;
  return new;
end;
$$;

drop trigger if exists team_memberships_season_sync on public.team_memberships;
create trigger team_memberships_season_sync
  before insert or update of team_id, season_id on public.team_memberships
  for each row
  execute function public.sync_team_membership_season();

-- Re-filing a team into another season has to drag its roster along, or the
-- copies rot.
create or replace function public.cascade_team_season_to_memberships()
returns trigger
language plpgsql
as $$
begin
  if new.season_id is distinct from old.season_id then
    update public.team_memberships
    set season_id = new.season_id
    where team_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists teams_season_cascade on public.teams;
create trigger teams_season_cascade
  after update of season_id on public.teams
  for each row
  execute function public.cascade_team_season_to_memberships();

-- Swap global uniqueness for per-season uniqueness. A bare NULL season_id would
-- read as distinct from every other NULL and let unfiled rosters double up, so
-- it collapses to a sentinel and those rows stay mutually exclusive as before.
drop index if exists public.team_memberships_active_profile_unique;
drop index if exists public.team_memberships_active_player_name_unique;

-- The old global indexes are not reliably present on every environment, so rows
-- that already break the new per-season rule may exist. Say so plainly instead
-- of letting CREATE UNIQUE INDEX fail with a bare duplicate-key error.
do $$
declare
  offenders int;
begin
  select count(*) into offenders from (
    select 1
    from public.team_memberships
    where is_active = true and left_at is null and profile_id is not null
    group by profile_id, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    having count(*) > 1
  ) dupes;

  if offenders > 0 then
    raise exception
      'Cannot season-scope rosters: % player(s) hold more than one active membership in the same season. Run supabase/queries/find_duplicate_active_memberships.sql and deactivate the wrong rows first.',
      offenders;
  end if;

  select count(*) into offenders from (
    select 1
    from public.team_memberships
    where is_active = true and left_at is null and player_name is not null
    group by lower(player_name), coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    having count(*) > 1
  ) dupes;

  if offenders > 0 then
    raise exception
      'Cannot season-scope rosters: % player name(s) appear on more than one active roster in the same season. Run supabase/queries/find_duplicate_active_memberships.sql and deactivate the wrong rows first.',
      offenders;
  end if;
end;
$$;

create unique index if not exists team_memberships_active_profile_season_unique
  on public.team_memberships (
    profile_id,
    coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active = true and left_at is null and profile_id is not null;

create unique index if not exists team_memberships_active_player_name_season_unique
  on public.team_memberships (
    lower(player_name),
    coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_active = true and left_at is null and player_name is not null;
