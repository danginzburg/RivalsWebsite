-- Replace legacy foreign keys that referenced public.player_registration(profile_id)
-- with foreign keys to public.profiles(id).

do $$
declare r record;
begin
  -- team_memberships.profile_id
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.team_memberships'::regclass
      and contype = 'f'
      and confrelid = 'public.player_registration'::regclass
  loop
    execute format('alter table public.team_memberships drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_memberships'::regclass
      and contype = 'f'
      and conname = 'team_memberships_profile_id_fkey'
  ) then
    alter table public.team_memberships
      add constraint team_memberships_profile_id_fkey
      foreign key (profile_id)
      references public.profiles(id)
      on delete cascade;
  end if;

  -- free_agent_listings.profile_id
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.free_agent_listings'::regclass
      and contype = 'f'
      and confrelid = 'public.player_registration'::regclass
  loop
    execute format('alter table public.free_agent_listings drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.free_agent_listings'::regclass
      and contype = 'f'
      and conname = 'free_agent_listings_profile_id_fkey'
  ) then
    alter table public.free_agent_listings
      add constraint free_agent_listings_profile_id_fkey
      foreign key (profile_id)
      references public.profiles(id)
      on delete cascade;
  end if;

  -- player_match_stats.profile_id
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.player_match_stats'::regclass
      and contype = 'f'
      and confrelid = 'public.player_registration'::regclass
  loop
    execute format('alter table public.player_match_stats drop constraint %I', r.conname);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.player_match_stats'::regclass
      and contype = 'f'
      and conname = 'player_match_stats_profile_id_fkey'
  ) then
    alter table public.player_match_stats
      add constraint player_match_stats_profile_id_fkey
      foreign key (profile_id)
      references public.profiles(id)
      on delete cascade;
  end if;
end $$;
