-- Signup eligibility: competitive games played in V26.
--
-- A player needs 100 V26 competitive games on their main account. HenrikDev is
-- rate limited, so the admin rank lookups store the result here rather than the
-- signup list asking for it on every load.
--
-- `v26_comp_games` is the main account's total, never a sum across
-- accounts. Null means not checked yet.

alter table public.player_signups
  add column if not exists v26_comp_games integer,
  add column if not exists v26_comp_games_account text,
  add column if not exists v26_comp_games_checked_at timestamptz;
