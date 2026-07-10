-- Ensure player_match_map_stats has the player_name column.
-- The column was defined in the original 20260303_002 migration but may not
-- exist in databases where an earlier revision of that migration was applied.

alter table public.player_match_map_stats
  add column if not exists player_name text;
