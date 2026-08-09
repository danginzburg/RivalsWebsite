-- Threaded comments for match and player pages, with reporting and moderation.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  -- What is being commented on. Kept generic so the same component can be
  -- mounted on any future entity type without a schema change.
  entity_type text not null check (entity_type in ('match', 'player')),
  entity_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Null for a top-level comment; set for a reply. Replies are one level deep.
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  -- Soft delete: the row is kept so replies keep their parent, but the body
  -- is hidden behind a tombstone in the UI.
  is_deleted boolean not null default false,
  deleted_by_profile_id uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comments_entity_idx on public.comments(entity_type, entity_id);
create index if not exists comments_parent_idx on public.comments(parent_id);
create index if not exists comments_profile_idx on public.comments(profile_id);
create index if not exists comments_created_idx on public.comments(created_at);

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- Reports raised by users against a comment.
create table if not exists public.comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  reporter_profile_id uuid not null references public.profiles(id) on delete cascade,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'dismissed')),
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  -- A user can only report the same comment once.
  unique (comment_id, reporter_profile_id)
);

create index if not exists comment_reports_status_idx on public.comment_reports(status);
create index if not exists comment_reports_comment_idx on public.comment_reports(comment_id);

-- Per-user commenting ban, enforced in the API layer.
alter table public.profiles
  add column if not exists comments_banned_until timestamptz,
  add column if not exists comments_ban_reason text;

alter table public.comments enable row level security;
alter table public.comment_reports enable row level security;

-- Reads are public; all writes go through the service role in the API layer,
-- which enforces authorship, ban status, and rate limits.
drop policy if exists "comments_select" on public.comments;
create policy "comments_select" on public.comments
  for select using (true);

drop policy if exists "comment_reports_select" on public.comment_reports;
create policy "comment_reports_select" on public.comment_reports
  for select using (false);
