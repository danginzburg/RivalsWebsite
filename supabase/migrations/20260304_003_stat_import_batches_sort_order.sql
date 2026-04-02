-- Optional manual ordering for stat import batches.

alter table public.stat_import_batches
  add column if not exists sort_order integer;

create index if not exists stat_import_batches_sort_order_idx
  on public.stat_import_batches(sort_order);
