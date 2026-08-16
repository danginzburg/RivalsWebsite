-- Up/down votes on comments.
--
-- One row per (comment, voter). Changing your mind updates the row and taking
-- the vote back deletes it, so the score is always `sum(value)` and there is no
-- separate "no vote" state to keep consistent.

create table if not exists public.comment_votes (
  comment_id uuid not null references public.comments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- +1 up, -1 down. Constrained rather than a boolean so the score is a plain
  -- sum and a third value can never sneak in.
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (comment_id, profile_id)
);

-- Scores are read per comment for a whole thread at a time.
create index if not exists comment_votes_comment_idx on public.comment_votes(comment_id);
-- And the viewer's own votes are read across that same set of comments.
create index if not exists comment_votes_profile_idx on public.comment_votes(profile_id);

drop trigger if exists comment_votes_set_updated_at on public.comment_votes;
create trigger comment_votes_set_updated_at
  before update on public.comment_votes
  for each row execute function public.set_updated_at();

alter table public.comment_votes enable row level security;

-- Same shape as `comments`: reads are public so scores render for signed-out
-- visitors, and every write goes through the service role in the API layer,
-- which enforces authorship, ban status, and rate limits.
drop policy if exists "comment_votes_select" on public.comment_votes;
create policy "comment_votes_select" on public.comment_votes
  for select using (true);
