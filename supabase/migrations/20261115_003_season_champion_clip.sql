-- The winning moment for a season: a clip link (YouTube, Twitch, Streamable, or
-- any URL) shown on the season's champion card in the Hall of Fame.
-- New column on an existing table, so the table's existing grants cover it.

alter table public.seasons
  add column if not exists champion_clip_url text;
