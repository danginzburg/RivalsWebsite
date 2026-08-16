-- Advanced stats on the aggregate table behind the /stats page.
--
-- Mirrors the columns added to `player_match_map_stats`, because the stats page
-- reads `rivals_group_stats` and nothing joins the two — a batch is a snapshot,
-- not a live view over matches.
--
-- These stay NULL on every CSV-imported batch: a spreadsheet has no multikill
-- or clutch data to give. Only batches generated from Riot-imported matches
-- carry them, which is why nullable-with-no-default matters here as well —
-- a dash reads as "this import never counted them", a zero would be a lie.

alter table public.rivals_group_stats
  add column if not exists mk_2k integer,
  add column if not exists mk_3k integer,
  add column if not exists mk_4k integer,
  add column if not exists mk_5k integer,
  add column if not exists clutches_won integer,
  add column if not exists clutches_attempted integer;

comment on column public.rivals_group_stats.mk_5k is
  'Rounds with exactly five kills — an ace. NULL on CSV-imported batches.';
comment on column public.rivals_group_stats.clutches_attempted is
  'Rounds entered as the last player alive against at least one opponent.';
