-- Per-match, per-map stats import tables.

create table if not exists public.match_maps (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  map_order smallint not null,
  map_name text,
  team_a_rounds smallint,
  team_b_rounds smallint,
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  source_filename text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, map_order)
);

create index if not exists match_maps_match_idx on public.match_maps(match_id);

drop trigger if exists set_updated_at_match_maps on public.match_maps;
create trigger set_updated_at_match_maps
before update on public.match_maps
for each row execute function public.set_updated_at();

create table if not exists public.player_match_map_stats (
  id bigserial primary key,
  match_map_id uuid not null references public.match_maps(id) on delete cascade,
  match_id uuid not null references public.matches(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  player_name text,
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
  unique (match_map_id, profile_id)
);

create index if not exists player_match_map_stats_match_idx on public.player_match_map_stats(match_id);
create index if not exists player_match_map_stats_map_idx on public.player_match_map_stats(match_map_id);
create index if not exists player_match_map_stats_profile_idx on public.player_match_map_stats(profile_id);

drop trigger if exists set_updated_at_player_match_map_stats on public.player_match_map_stats;
create trigger set_updated_at_player_match_map_stats
before update on public.player_match_map_stats
for each row execute function public.set_updated_at();
