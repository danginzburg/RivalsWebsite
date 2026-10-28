-- Optional 3rd place on season results. Seasons with a bracket the site can
-- draw read 3rd off it; this column is for seasons whose format it cannot (and
-- overrides the bracket when set).

alter table public.seasons
  add column if not exists third_place_team_id uuid references public.teams(id) on delete set null;
