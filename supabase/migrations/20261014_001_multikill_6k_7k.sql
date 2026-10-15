-- 6K and 7K+ multikill columns.
--
-- A Sage resurrect can put an opponent back into the round, so a sixth kill is
-- possible. The importer used to fold anything past five into mk_5k; it now
-- keeps 6 and 7+ apart so an ace stays exactly an ace.
--
-- Nullable with no default, like the other multikill columns: NULL means "not
-- counted". Rows that already have API multikills are backfilled to 0 so they
-- show a zero rather than a dash — any 6k among them was counted as a 5k and
-- only a re-import separates it out.

alter table public.player_match_map_stats
  add column if not exists mk_6k integer,
  add column if not exists mk_7k integer;

alter table public.rivals_group_stats
  add column if not exists mk_6k integer,
  add column if not exists mk_7k integer;

update public.player_match_map_stats
  set mk_6k = coalesce(mk_6k, 0), mk_7k = coalesce(mk_7k, 0)
  where mk_5k is not null;

update public.rivals_group_stats
  set mk_6k = coalesce(mk_6k, 0), mk_7k = coalesce(mk_7k, 0)
  where mk_5k is not null;

comment on column public.player_match_map_stats.mk_6k is
  'Rounds with exactly six kills — only possible after a revive.';
comment on column public.player_match_map_stats.mk_7k is
  'Rounds with seven or more kills.';
comment on column public.rivals_group_stats.mk_6k is
  'Rounds with exactly six kills. NULL on CSV-imported batches.';
comment on column public.rivals_group_stats.mk_7k is
  'Rounds with seven or more kills. NULL on CSV-imported batches.';
