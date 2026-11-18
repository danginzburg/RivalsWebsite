-- Indexes for player name and PUUID matching.
--
-- Stat rows are matched to players with case-insensitive `ilike` filters on
-- player names (an exact name, or `name#%` for any tag) and with
-- `metadata->>puuid` lookups. None of those could use an index, so each one
-- was a full scan of the stat tables, and they get slower as more seasons are
-- added. Trigram GIN indexes cover `ilike` in both forms, and an expression
-- index covers the metadata PUUID.
--
-- No new tables, so no grants are needed.

create extension if not exists pg_trgm with schema extensions;

create index if not exists player_match_map_stats_player_name_trgm_idx
  on public.player_match_map_stats using gin (player_name extensions.gin_trgm_ops);

create index if not exists player_match_map_stats_metadata_puuid_idx
  on public.player_match_map_stats ((metadata->>'puuid'))
  where metadata ? 'puuid';

-- Rows still waiting for a profile, which claim and relink scans filter on.
create index if not exists player_match_map_stats_unlinked_idx
  on public.player_match_map_stats (player_name)
  where profile_id is null;

create index if not exists rivals_group_stats_player_name_trgm_idx
  on public.rivals_group_stats using gin (player_name extensions.gin_trgm_ops);

create index if not exists riot_accounts_riot_name_trgm_idx
  on public.riot_accounts using gin (riot_name extensions.gin_trgm_ops);

create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (display_name extensions.gin_trgm_ops);
