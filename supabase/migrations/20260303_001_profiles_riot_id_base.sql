-- Add Riot ID base name to profiles for stats matching.

alter table public.profiles
  add column if not exists riot_id_base text;

create unique index if not exists profiles_riot_id_base_unique
  on public.profiles (lower(riot_id_base))
  where riot_id_base is not null;
