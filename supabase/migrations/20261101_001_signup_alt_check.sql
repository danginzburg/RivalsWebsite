-- The last comparison of a signup's main account against its alts: games since
-- V26 Act 1, base score, which account the ranks came from, and whether an alt
-- out-scores the main. Null until checked; a player's edit clears it.

alter table public.player_signups
  add column if not exists alt_check jsonb;
