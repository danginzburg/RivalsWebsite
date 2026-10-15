-- Manual corrections on top of the standings computed from imported matches.
--
-- The leaderboard is calculated from a season's completed, approved matches
-- (see src/lib/server/leaderboard/computed.ts) and materialized as an ordinary
-- `leaderboard_entries` batch, so every page that already reads the newest
-- standings batch picks it up unchanged. This table records only what an admin
-- changed by hand: deltas added to the calculated numbers, and an optional
-- pinned rank for tiebreaks the formula cannot know about (head-to-head, a
-- ruling). Deltas rather than absolute values so the correction survives the
-- next match import instead of freezing the team's line.

create table if not exists public.leaderboard_adjustments (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,

  wins integer not null default 0,
  losses integer not null default 0,
  map_wins integer not null default 0,
  map_losses integer not null default 0,
  round_diff integer not null default 0,
  points integer not null default 0,

  -- 1-based position the team is pinned to; null leaves it to the sort.
  rank_override integer check (rank_override is null or rank_override > 0),

  note text,
  updated_by_profile_id uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (season_id, team_id)
);

create index if not exists leaderboard_adjustments_season_idx
  on public.leaderboard_adjustments (season_id);

drop trigger if exists leaderboard_adjustments_set_updated_at on public.leaderboard_adjustments;
create trigger leaderboard_adjustments_set_updated_at
  before update on public.leaderboard_adjustments
  for each row execute function public.set_updated_at();

alter table public.leaderboard_adjustments enable row level security;

-- Admin-only, through the service role.
drop policy if exists "leaderboard_adjustments_select" on public.leaderboard_adjustments;
create policy "leaderboard_adjustments_select" on public.leaderboard_adjustments
  for select using (false);
