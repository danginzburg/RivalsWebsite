-- Clash Group Stats: aggregate player stats imported from CSV
create table if not exists public.clash_group_stats (
  id bigserial primary key,
  player_name text not null,
  profile_id uuid references public.profiles(id) on delete set null,
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
  kpg double precision,
  kpr double precision,
  deaths integer,
  dpg double precision,
  dpr double precision,
  assists integer,
  apg double precision,
  apr double precision,
  fk integer,
  fkpg double precision,
  fd integer,
  fdpg double precision,
  hs_pct double precision,
  plants integer,
  plants_per_game double precision,
  defuses integer,
  defuses_per_game double precision,
  econ_rating double precision,
  import_batch_id uuid not null default gen_random_uuid(),
  imported_by_profile_id uuid references public.profiles(id) on delete set null,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clash_group_stats_player_idx on public.clash_group_stats(player_name);
create index if not exists clash_group_stats_profile_idx on public.clash_group_stats(profile_id);
create index if not exists clash_group_stats_batch_idx on public.clash_group_stats(import_batch_id);

-- RLS policies
alter table public.clash_group_stats enable row level security;

-- Anyone can read stats
create policy "clash_group_stats_select" on public.clash_group_stats
  for select using (true);

-- Only admins can insert
create policy "clash_group_stats_insert" on public.clash_group_stats
  for insert with check (
    exists (
      select 1 from public.profiles
      where profiles.id = clash_group_stats.imported_by_profile_id
        and profiles.role = 'admin'
    )
  );

-- Only admins can update
create policy "clash_group_stats_update" on public.clash_group_stats
  for update using (
    exists (
      select 1 from public.profiles
      where profiles.id = clash_group_stats.imported_by_profile_id
        and profiles.role = 'admin'
    )
  );

-- Only admins can delete
create policy "clash_group_stats_delete" on public.clash_group_stats
  for delete using (
    exists (
      select 1 from public.profiles
      where profiles.id = clash_group_stats.imported_by_profile_id
        and profiles.role = 'admin'
    )
  );
