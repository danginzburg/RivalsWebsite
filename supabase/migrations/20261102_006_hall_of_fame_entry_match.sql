-- A Hall of Fame moment can point at the match it happened in, so its card
-- links back there (and the admin form can fill in season and teams from it).

alter table public.hall_of_fame_entries
  add column if not exists match_id uuid references public.matches(id) on delete set null;

create index if not exists hall_of_fame_match_idx on public.hall_of_fame_entries(match_id);
