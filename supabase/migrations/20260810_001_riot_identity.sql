-- Riot identity: tagline and PUUID.
--
-- `riot_id_base` deliberately stores only the name before '#', but every Riot
-- and third-party API needs the full name#tag pair. PUUID is the stable id
-- that survives name changes, so it is the better key for stats matching.

alter table public.profiles
  add column if not exists riot_tag text,
  add column if not exists riot_puuid text,
  -- When the identity was last confirmed against the Riot account API.
  add column if not exists riot_verified_at timestamptz;

-- A PUUID identifies exactly one account, so it must not be shared.
create unique index if not exists profiles_riot_puuid_unique
  on public.profiles (riot_puuid)
  where riot_puuid is not null;

create index if not exists profiles_riot_tag_idx on public.profiles (riot_tag);

-- Signups capture the tag alongside the name so an admin can look the player
-- up before the profile is verified.
alter table public.player_signups
  add column if not exists riot_tag text;
