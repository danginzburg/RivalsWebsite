-- On-site notifications: a per-user feed surfaced by a header bell.
--
-- Rows are denormalized (title/body/link) so the dropdown renders with no joins.
-- Writes and reads both go through the service role in the API layer, which
-- resolves the viewer's profile id and filters by it; RLS stays closed.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in (
    'signup_approved', 'signup_rejected', 'comment_reply',
    'comment_deleted', 'comment_upvote', 'result_report_resolved'
  )),

  -- Denormalized rendering fields.
  title text not null,
  body text,
  link text,

  -- Structured refs kept for future filtering; not required to render.
  actor_profile_id uuid references public.profiles(id) on delete set null,
  entity_type text,
  entity_id uuid,

  -- Aggregation: while unread, rows sharing a dedupe_key are merged in place
  -- rather than stacked (used for "N people upvoted your comment").
  dedupe_key text,
  actor_count integer not null default 1,

  is_read boolean not null default false,
  read_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The bell query: a recipient's rows, unread first, newest first.
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_profile_id, is_read, created_at desc);

-- Fast lookup of the open row to merge an aggregated event into.
create index if not exists notifications_dedupe_idx
  on public.notifications (recipient_profile_id, dedupe_key)
  where is_read = false and dedupe_key is not null;

drop trigger if exists notifications_set_updated_at on public.notifications;
create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;

-- Reads are restricted; the app serves each user only their own rows.
drop policy if exists "notifications_select" on public.notifications;
create policy "notifications_select" on public.notifications
  for select using (false);
