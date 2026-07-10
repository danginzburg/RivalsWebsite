alter table public.match_maps
  add column if not exists is_voided boolean not null default false;
