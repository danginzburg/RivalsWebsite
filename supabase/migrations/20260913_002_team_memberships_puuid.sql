-- Bind roster slots to a stable Riot identity.
--
-- Rosters were stored as free-text handles typed at team creation ("Pickles",
-- "F1renation"), which do not match the Riot IDs that appear in imported stats
-- ("picklesvl#ttv", "F火RE#FLAME"). That made sub detection — "did a player on
-- the roster play this match?" — unreliable, because the only bridge was a name
-- that rarely matches.
--
-- The PUUID is the stable key that also rides on every stat row, so recording it
-- on the membership lets a roster slot be matched to its stats exactly, through
-- renames and without a profile link. profile_id remains the richer link (it
-- carries alts and aliases); puuid is the minimum needed to match by identity.

alter table public.team_memberships
  add column if not exists puuid text;

create index if not exists team_memberships_puuid_idx
  on public.team_memberships (puuid)
  where puuid is not null;
