-- Rank history, one row per player per tournament.
--
-- `riot_accounts.rank` only says where a player stands now. Stats for an event
-- must show the rank players had during that event, so each tournament keeps
-- its own: the highest rank the player held between the season's start and
-- end dates, read from their ranked match history. Match imports refresh it for
-- everyone in the series, so it climbs as the tournament goes on and stops
-- moving once the end date has passed.
--
-- Keyed by PUUID, the rename-proof identity, so it follows a player through
-- name changes and survives an account being relinked to a profile.

create table if not exists public.riot_season_ranks (
  puuid text not null,
  season_id uuid not null references public.seasons(id) on delete cascade,
  -- League scale: "Gold 2", "Immortal 3", "Radiant".
  rank text not null,
  -- The window the rank was taken over, as used at the last refresh.
  window_start timestamptz not null,
  window_end timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (puuid, season_id)
);

create index if not exists riot_season_ranks_season_idx
  on public.riot_season_ranks (season_id);

alter table public.riot_season_ranks enable row level security;
