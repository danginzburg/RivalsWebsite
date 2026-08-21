-- Team name/tag uniqueness among approved teams was global, so a team could not
-- be approved if any past-or-present season already had an approved team with the
-- same name or tag. Rosters rebuild each season and orgs reuse names and tags, so
-- the same "Team Alpha" / "TA" is expected to appear once per season. Scope both
-- unique indexes to the season the team is filed under so a reused name/tag only
-- collides within its own season.
--
-- A bare NULL season_id would read as distinct from every other NULL and let
-- unfiled teams double up, so it collapses to a sentinel and those rows stay
-- mutually exclusive as before.
drop index if exists public.teams_name_approved_unique;
drop index if exists public.teams_tag_approved_unique;

-- The old global indexes cannot be recreated per-season if rows already break the
-- new rule. Say so plainly instead of letting CREATE UNIQUE INDEX fail with a bare
-- duplicate-key error.
do $$
declare
  offenders int;
begin
  select count(*) into offenders from (
    select 1
    from public.teams
    where approval_status = 'approved'
    group by lower(name), coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    having count(*) > 1
  ) dupes;

  if offenders > 0 then
    raise exception
      'Cannot season-scope team names: % name(s) are held by more than one approved team in the same season. Deactivate or rename the wrong rows first.',
      offenders;
  end if;

  select count(*) into offenders from (
    select 1
    from public.teams
    where approval_status = 'approved' and tag is not null
    group by lower(tag), coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
    having count(*) > 1
  ) dupes;

  if offenders > 0 then
    raise exception
      'Cannot season-scope team tags: % tag(s) are held by more than one approved team in the same season. Deactivate or rename the wrong rows first.',
      offenders;
  end if;
end;
$$;

create unique index if not exists teams_name_approved_season_unique
  on public.teams (
    lower(name),
    coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where approval_status = 'approved';

create unique index if not exists teams_tag_approved_season_unique
  on public.teams (
    lower(tag),
    coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where approval_status = 'approved' and tag is not null;
