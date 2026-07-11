alter table public.rivals_group_stats
  add column if not exists league_rank text;
