-- Admin adjustment added on top of a signup's formula score, positive or
-- negative. Kept apart from `computed_value` so the formula result stays
-- visible and re-scoring never wipes an admin's adjustment.

alter table public.player_signups
  add column if not exists manual_adjustment numeric not null default 0;
