-- Add season_id to teams for season-scoping
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS season_id uuid REFERENCES public.seasons(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS teams_season_id_idx ON public.teams(season_id);
