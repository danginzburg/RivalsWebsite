-- Which season the /signup page registers players for, independent of which
-- season is active. This lets the next season's signups open while the
-- current event (e.g. an external league) is still running, without any of the
-- signups being stored against the running event.
--
-- When no season has the flag set, the app falls back to the active season,
-- but only if that season is a Rivals event.

alter table public.seasons
  add column if not exists signups_open boolean not null default false;

-- At most one season takes signups at a time.
create unique index if not exists seasons_single_signups_open_idx
  on public.seasons (signups_open)
  where signups_open;
