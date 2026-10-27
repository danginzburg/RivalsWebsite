-- Per-player performance rating, the input to the signup score bonus:
--
--   score = 0.35 * current rank points + 0.65 * peak rank points + bonus
--   bonus = MIN(5, 10 * MAX(0, rating - 1))
--
-- Loaded once from an externally calculated sheet; ratings will be calculated
-- on the site later. A signup is matched to its rating by Riot name,
-- case-insensitively, through `name_key`.

create table if not exists public.player_ratings (
  player_name text primary key,
  name_key text generated always as (lower(btrim(player_name))) stored,
  rating numeric not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists player_ratings_name_key_idx
  on public.player_ratings (name_key);

alter table public.player_ratings enable row level security;

-- Service-role only: read when scoring signups.
