-- Advanced per-map stats, available once a match is imported from the Riot
-- match API rather than a CSV.
--
-- Only the headline numbers get columns: these are the ones a stats table
-- sorts and filters on, and a jsonb lookup per row makes that needlessly slow.
-- The full breakdown (1v1 … 1v5 clutches, and anything added later) stays in
-- `metadata`, which already exists on this table and was previously unused by
-- the importer.
--
-- All nullable with no default: NULL means "this match predates the API import
-- and we do not know", which is a different statement from 0.

alter table public.player_match_map_stats
  -- Rounds in which the player got exactly N kills.
  add column if not exists mk_2k integer,
  add column if not exists mk_3k integer,
  add column if not exists mk_4k integer,
  add column if not exists mk_5k integer,
  -- 1vX situations entered, and how many were won.
  add column if not exists clutches_won integer,
  add column if not exists clutches_attempted integer;

comment on column public.player_match_map_stats.mk_5k is
  'Rounds with exactly five kills — an ace.';
comment on column public.player_match_map_stats.clutches_attempted is
  'Rounds entered as the last player alive against at least one opponent.';
comment on column public.player_match_map_stats.metadata is
  'Riot puuid and the full clutch/multikill breakdown for API-imported maps.';
