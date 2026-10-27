-- Phase 2 of 20261027_004_unified_player_identity.sql.
--
-- Run by hand once the app that reads `riot_accounts` / `player_directory` is
-- deployed. Until then the old app still reads these, so dropping them early
-- breaks the live site.

drop table if exists public.profile_riot_accounts;
drop table if exists public.riot_identities;

drop index if exists public.profiles_riot_id_base_unique;
drop index if exists public.profiles_stats_player_name_unique;
drop index if exists public.profiles_riot_puuid_unique;
drop index if exists public.profiles_riot_tag_idx;

alter table public.profiles
  drop column if exists riot_id_base,
  drop column if exists riot_tag,
  drop column if exists riot_puuid,
  drop column if exists riot_verified_at,
  drop column if exists stats_player_name,
  -- Published contact details are read from the approved signup instead.
  drop column if exists discord_handle,
  drop column if exists tracker_links;

-- The Riot ID is read from the player's primary account, not a per-signup copy.
alter table public.player_signups
  drop column if exists display_name,
  drop column if exists riot_tag;
