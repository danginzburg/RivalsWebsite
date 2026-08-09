-- Backfill season_id for existing matches and teams that predate season-scoping.
-- Assigns all NULL season_id records to the currently active season.

UPDATE public.matches
SET season_id = (SELECT id FROM public.seasons WHERE is_active = true LIMIT 1)
WHERE season_id IS NULL;

UPDATE public.teams
SET season_id = (SELECT id FROM public.seasons WHERE is_active = true LIMIT 1)
WHERE season_id IS NULL
  AND approval_status = 'approved';
