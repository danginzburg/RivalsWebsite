-- Season results: who won, who was MVP, and which leaderboard snapshot is final.
-- Kept as real columns (rather than metadata JSON) so the events pages can join
-- and filter on them directly.

alter table public.seasons
  add column if not exists winner_team_id uuid references public.teams(id) on delete set null,
  add column if not exists runner_up_team_id uuid references public.teams(id) on delete set null,
  add column if not exists mvp_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists final_leaderboard_batch_id uuid,
  add column if not exists summary text;

create index if not exists seasons_winner_team_idx on public.seasons(winner_team_id);
create index if not exists seasons_mvp_profile_idx on public.seasons(mvp_profile_id);
