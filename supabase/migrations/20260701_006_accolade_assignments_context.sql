alter table public.accolade_assignments
  add column if not exists context text;
