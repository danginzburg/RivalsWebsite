-- Store roster joins and departures as moments, not calendar days.
--
-- Sub detection judges each match against the roster that stood when it was
-- played (a player who left, or whose team disbanded, stays main roster for the
-- matches already played). With day precision a departure could not be placed
-- relative to a match on the same day, so a player removed in the afternoon
-- still counted for that evening's match.
--
-- Existing rows keep their current meaning:
--   joined_at  day D  -> D 00:00 UTC   (covered matches from the start of D)
--   left_at    day D  -> D+1 00:00 UTC (a match on D still counted, and a
--                                       stint covers matches strictly before
--                                       left_at)

alter table public.team_memberships
  alter column joined_at drop default;

alter table public.team_memberships
  alter column joined_at type timestamptz using (joined_at::timestamp at time zone 'UTC'),
  alter column left_at type timestamptz using ((left_at + 1)::timestamp at time zone 'UTC');

alter table public.team_memberships
  alter column joined_at set default now();
