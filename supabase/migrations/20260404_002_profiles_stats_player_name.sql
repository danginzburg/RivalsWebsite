-- Optional alternate player name used for stats imports when Riot/Discord names drift.

alter table public.profiles
  add column if not exists stats_player_name text;

create unique index if not exists profiles_stats_player_name_unique
  on public.profiles (lower(stats_player_name))
  where stats_player_name is not null;
