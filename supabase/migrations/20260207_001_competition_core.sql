-- Core competition schema with admin-first approval workflows.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text,
  org text,
  logo_path text,
  status text not null default 'active' check (status in ('active', 'inactive', 'disbanded')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'disabled')),
  approval_notes text,
  submitted_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists teams_name_approved_unique
  on public.teams (lower(name))
  where approval_status = 'approved';

create unique index if not exists teams_tag_approved_unique
  on public.teams (lower(tag))
  where approval_status = 'approved' and tag is not null;

create index if not exists teams_approval_status_idx on public.teams(approval_status);
create index if not exists teams_submitted_by_idx on public.teams(submitted_by_profile_id);

create table if not exists public.team_memberships (
  id bigserial primary key,
  team_id uuid not null references public.teams(id) on delete cascade,
  profile_id uuid not null references public.player_registration(profile_id) on delete cascade,
  role text not null default 'player' check (role in ('player', 'captain', 'substitute', 'coach', 'manager')),
  joined_at date not null default current_date,
  left_at date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (left_at is null or left_at >= joined_at)
);

create index if not exists team_memberships_team_idx on public.team_memberships(team_id);
create index if not exists team_memberships_profile_idx on public.team_memberships(profile_id);

create unique index if not exists team_memberships_active_profile_unique
  on public.team_memberships (profile_id)
  where is_active = true and left_at is null;

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  invited_profile_id uuid references public.profiles(id) on delete cascade,
  invited_email text,
  invited_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  role text not null default 'player' check (role in ('player', 'captain', 'substitute', 'coach', 'manager')),
  message text,
  expires_at timestamptz,
  responded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invited_profile_id is not null or invited_email is not null)
);

create index if not exists team_invites_team_idx on public.team_invites(team_id);
create index if not exists team_invites_profile_idx on public.team_invites(invited_profile_id);
create index if not exists team_invites_status_idx on public.team_invites(status);

create table if not exists public.free_agent_listings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.player_registration(profile_id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  preferred_roles text[] not null default '{}',
  preferred_regions text[] not null default '{}',
  availability text,
  headline text,
  bio text,
  contact_links jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists free_agent_listings_status_idx on public.free_agent_listings(status);

create table if not exists public.match_proposals (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  proposed_by_team_id uuid not null references public.teams(id),
  opponent_team_id uuid not null references public.teams(id),
  proposed_by_profile_id uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'admin_review', 'approved', 'rejected')),
  best_of smallint not null default 3 check (best_of in (1, 3, 5, 7)),
  proposed_start_at timestamptz,
  notes text,
  approval_notes text,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_by_team_id <> opponent_team_id)
);

create index if not exists match_proposals_status_idx on public.match_proposals(status);
create index if not exists match_proposals_team_a_idx on public.match_proposals(proposed_by_team_id);
create index if not exists match_proposals_team_b_idx on public.match_proposals(opponent_team_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid references public.seasons(id) on delete set null,
  proposal_id uuid unique references public.match_proposals(id) on delete set null,
  stage text,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'completed', 'cancelled')),
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  approval_notes text,
  best_of smallint not null default 3 check (best_of in (1, 3, 5, 7)),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  team_a_id uuid not null references public.teams(id),
  team_b_id uuid not null references public.teams(id),
  winner_team_id uuid references public.teams(id),
  team_a_score smallint not null default 0,
  team_b_score smallint not null default 0,
  submitted_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_a_id <> team_b_id),
  check (
    winner_team_id is null
    or winner_team_id = team_a_id
    or winner_team_id = team_b_id
  )
);

create index if not exists matches_season_idx on public.matches(season_id);
create index if not exists matches_status_idx on public.matches(status);
create index if not exists matches_approval_status_idx on public.matches(approval_status);
create index if not exists matches_scheduled_at_idx on public.matches(scheduled_at);
create index if not exists matches_team_a_idx on public.matches(team_a_id);
create index if not exists matches_team_b_idx on public.matches(team_b_id);

create table if not exists public.match_map_veto_actions (
  id bigserial primary key,
  match_id uuid references public.matches(id) on delete cascade,
  proposal_id uuid references public.match_proposals(id) on delete cascade,
  acting_team_id uuid not null references public.teams(id),
  acting_profile_id uuid not null references public.profiles(id),
  action_type text not null check (action_type in ('ban', 'pick', 'decider', 'protect')),
  map_name text not null,
  action_order integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (match_id is not null or proposal_id is not null)
);

create unique index if not exists match_map_veto_actions_match_order_unique
  on public.match_map_veto_actions (match_id, action_order)
  where match_id is not null;

create unique index if not exists match_map_veto_actions_proposal_order_unique
  on public.match_map_veto_actions (proposal_id, action_order)
  where proposal_id is not null;

create table if not exists public.match_streams (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  platform text not null default 'twitch' check (platform in ('twitch', 'youtube', 'kick', 'other')),
  stream_url text not null,
  is_primary boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended')),
  added_by_profile_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists match_streams_match_idx on public.match_streams(match_id);

create unique index if not exists match_streams_primary_unique
  on public.match_streams (match_id)
  where is_primary = true;

create table if not exists public.player_match_stats (
  id bigserial primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.player_registration(profile_id) on delete cascade,
  team_id uuid not null references public.teams(id),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  agents text,
  games integer,
  games_won integer,
  games_lost integer,
  rounds integer,
  rounds_won integer,
  rounds_lost integer,
  acs double precision,
  kd double precision,
  kast_pct double precision,
  adr double precision,
  kills integer,
  deaths integer,
  assists integer,
  fk integer,
  fd integer,
  hs_pct double precision,
  econ_rating double precision,
  kpg double precision,
  kpr double precision,
  dpg double precision,
  dpr double precision,
  apg double precision,
  apr double precision,
  fkpg double precision,
  fdpg double precision,
  plants integer,
  plants_per_game double precision,
  defuses integer,
  defuses_per_game double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, profile_id)
);

create index if not exists player_match_stats_match_idx on public.player_match_stats(match_id);
create index if not exists player_match_stats_profile_idx on public.player_match_stats(profile_id);
create index if not exists player_match_stats_team_idx on public.player_match_stats(team_id);
create index if not exists player_match_stats_status_idx on public.player_match_stats(status);

create table if not exists public.stat_import_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by_profile_id uuid not null references public.profiles(id) on delete set null,
  season_id uuid references public.seasons(id) on delete set null,
  source_filename text not null,
  source_storage_path text,
  source_hash text,
  status text not null default 'uploaded' check (status in ('uploaded', 'validated', 'approved', 'rejected', 'applied')),
  dry_run boolean not null default true,
  row_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  approval_notes text,
  approved_by_profile_id uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stat_import_batches_status_idx on public.stat_import_batches(status);
create index if not exists stat_import_batches_season_idx on public.stat_import_batches(season_id);

create table if not exists public.stat_import_errors (
  id bigserial primary key,
  batch_id uuid not null references public.stat_import_batches(id) on delete cascade,
  row_number integer not null,
  field_name text,
  error_code text,
  error_message text not null,
  row_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stat_import_errors_batch_idx on public.stat_import_errors(batch_id);

create table if not exists public.leaderboard_entries (
  id bigserial primary key,
  season_id uuid references public.seasons(id) on delete cascade,
  split text not null default 'main',
  as_of_date date not null default current_date,
  team_id uuid not null references public.teams(id) on delete cascade,
  matches_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  map_wins integer not null default 0,
  map_losses integer not null default 0,
  round_wins integer not null default 0,
  round_losses integer not null default 0,
  points integer not null default 0,
  tiebreaker_score numeric(10,4) not null default 0,
  rank integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, split, as_of_date, team_id)
);

create index if not exists leaderboard_entries_lookup_idx
  on public.leaderboard_entries(season_id, split, as_of_date, rank);

create or replace view public.leaderboard_live as
with match_rows as (
  select
    m.id,
    m.season_id,
    m.team_a_id as team_id,
    m.team_b_id as opponent_id,
    m.team_a_score as team_score,
    m.team_b_score as opponent_score,
    m.winner_team_id
  from public.matches m
  where m.status = 'completed' and m.approval_status = 'approved'
  union all
  select
    m.id,
    m.season_id,
    m.team_b_id as team_id,
    m.team_a_id as opponent_id,
    m.team_b_score as team_score,
    m.team_a_score as opponent_score,
    m.winner_team_id
  from public.matches m
  where m.status = 'completed' and m.approval_status = 'approved'
)
select
  mr.season_id,
  mr.team_id,
  count(*)::integer as matches_played,
  count(*) filter (where mr.winner_team_id = mr.team_id)::integer as wins,
  count(*) filter (where mr.winner_team_id is not null and mr.winner_team_id <> mr.team_id)::integer as losses,
  coalesce(sum(mr.team_score), 0)::integer as map_wins,
  coalesce(sum(mr.opponent_score), 0)::integer as map_losses,
  coalesce(sum(mr.team_score), 0)::integer as round_wins,
  coalesce(sum(mr.opponent_score), 0)::integer as round_losses,
  (
    count(*) filter (where mr.winner_team_id = mr.team_id) * 3
    + count(*) filter (where mr.winner_team_id is null)
  )::integer as points,
  case
    when coalesce(sum(mr.opponent_score), 0) = 0 then coalesce(sum(mr.team_score), 0)::numeric(10,4)
    else round((coalesce(sum(mr.team_score), 0)::numeric / nullif(sum(mr.opponent_score), 0)::numeric), 4)
  end as tiebreaker_score
from match_rows mr
group by mr.season_id, mr.team_id;

create or replace function public.create_weekly_leaderboard_snapshot(
  p_season_id uuid,
  p_split text default 'main',
  p_as_of_date date default current_date
)
returns integer
language plpgsql
as $$
declare
  v_inserted_count integer;
begin
  with ranked_rows as (
    select
      l.season_id,
      p_split as split,
      p_as_of_date as as_of_date,
      l.team_id,
      l.matches_played,
      l.wins,
      l.losses,
      l.map_wins,
      l.map_losses,
      l.round_wins,
      l.round_losses,
      l.points,
      l.tiebreaker_score,
      row_number() over (
        order by l.points desc, l.tiebreaker_score desc, l.round_wins desc, l.team_id
      ) as rank
    from public.leaderboard_live l
    where l.season_id = p_season_id
  ),
  upserted as (
    insert into public.leaderboard_entries (
      season_id,
      split,
      as_of_date,
      team_id,
      matches_played,
      wins,
      losses,
      map_wins,
      map_losses,
      round_wins,
      round_losses,
      points,
      tiebreaker_score,
      rank,
      metadata
    )
    select
      rr.season_id,
      rr.split,
      rr.as_of_date,
      rr.team_id,
      rr.matches_played,
      rr.wins,
      rr.losses,
      rr.map_wins,
      rr.map_losses,
      rr.round_wins,
      rr.round_losses,
      rr.points,
      rr.tiebreaker_score,
      rr.rank,
      jsonb_build_object('generated_from', 'leaderboard_live')
    from ranked_rows rr
    on conflict (season_id, split, as_of_date, team_id)
    do update set
      matches_played = excluded.matches_played,
      wins = excluded.wins,
      losses = excluded.losses,
      map_wins = excluded.map_wins,
      map_losses = excluded.map_losses,
      round_wins = excluded.round_wins,
      round_losses = excluded.round_losses,
      points = excluded.points,
      tiebreaker_score = excluded.tiebreaker_score,
      rank = excluded.rank,
      metadata = excluded.metadata,
      updated_at = now()
    returning 1
  )
  select count(*) into v_inserted_count from upserted;

  return coalesce(v_inserted_count, 0);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-icons', 'profile-icons', true, 5242880, array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('team-logos', 'team-logos', true, 5242880, array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('stats-imports', 'stats-imports', false, 52428800, array['text/csv', 'application/vnd.ms-excel'])
on conflict (id) do nothing;

drop trigger if exists trg_seasons_updated_at on public.seasons;
create trigger trg_seasons_updated_at
before update on public.seasons
for each row execute function public.set_updated_at();

drop trigger if exists trg_teams_updated_at on public.teams;
create trigger trg_teams_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists trg_team_memberships_updated_at on public.team_memberships;
create trigger trg_team_memberships_updated_at
before update on public.team_memberships
for each row execute function public.set_updated_at();

drop trigger if exists trg_team_invites_updated_at on public.team_invites;
create trigger trg_team_invites_updated_at
before update on public.team_invites
for each row execute function public.set_updated_at();

drop trigger if exists trg_free_agent_listings_updated_at on public.free_agent_listings;
create trigger trg_free_agent_listings_updated_at
before update on public.free_agent_listings
for each row execute function public.set_updated_at();

drop trigger if exists trg_match_proposals_updated_at on public.match_proposals;
create trigger trg_match_proposals_updated_at
before update on public.match_proposals
for each row execute function public.set_updated_at();

drop trigger if exists trg_matches_updated_at on public.matches;
create trigger trg_matches_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

drop trigger if exists trg_match_streams_updated_at on public.match_streams;
create trigger trg_match_streams_updated_at
before update on public.match_streams
for each row execute function public.set_updated_at();

drop trigger if exists trg_player_match_stats_updated_at on public.player_match_stats;
create trigger trg_player_match_stats_updated_at
before update on public.player_match_stats
for each row execute function public.set_updated_at();

drop trigger if exists trg_stat_import_batches_updated_at on public.stat_import_batches;
create trigger trg_stat_import_batches_updated_at
before update on public.stat_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists trg_leaderboard_entries_updated_at on public.leaderboard_entries;
create trigger trg_leaderboard_entries_updated_at
before update on public.leaderboard_entries
for each row execute function public.set_updated_at();
