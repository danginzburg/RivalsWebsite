-- Add display fields for stat import batches (week-by-week + aggregate).

alter table public.stat_import_batches
  add column if not exists display_name text,
  add column if not exists import_kind text not null default 'weekly' check (import_kind in ('weekly', 'aggregate')),
  add column if not exists week_label text;

update public.stat_import_batches
set display_name = coalesce(display_name, source_filename)
where display_name is null;
