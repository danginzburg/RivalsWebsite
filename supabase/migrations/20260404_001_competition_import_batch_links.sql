-- Link imported leaderboard rows back to their import batch and store round differential.

alter table public.leaderboard_entries
  add column if not exists import_batch_id uuid references public.stat_import_batches(id) on delete set null,
  add column if not exists round_diff integer not null default 0;

create index if not exists leaderboard_entries_import_batch_idx
  on public.leaderboard_entries(import_batch_id);
