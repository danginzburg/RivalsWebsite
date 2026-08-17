-- User-submitted "this data looks wrong" flags for matches and player profiles.
--
-- Mirrors comment_reports: users file a flag, admins triage it from the
-- Moderation tab and mark it resolved/dismissed. entity_id points at either
-- matches(id) or profiles(id) depending on entity_type, so it carries no FK.
-- Reads/writes go through the service role; RLS stays closed.

create table if not exists public.review_flags (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('match', 'player')),
  entity_id uuid not null,
  reporter_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- A flag exists to point admins at bad data, so the description is required.
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'dismissed')),
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_flags_status_idx on public.review_flags(status);
create index if not exists review_flags_entity_idx
  on public.review_flags(entity_type, entity_id);

-- A user may only have one *open* flag per entity, but can flag again after a
-- prior flag has been resolved or dismissed.
create unique index if not exists review_flags_pending_unique
  on public.review_flags(entity_type, entity_id, reporter_profile_id)
  where status = 'pending';

drop trigger if exists review_flags_set_updated_at on public.review_flags;
create trigger review_flags_set_updated_at
  before update on public.review_flags
  for each row execute function public.set_updated_at();

alter table public.review_flags enable row level security;

-- The app serves flags only to admins through the service role.
drop policy if exists "review_flags_select" on public.review_flags;
create policy "review_flags_select" on public.review_flags
  for select using (false);

-- Let the notification feed carry a "your flag was reviewed" event.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'signup_approved', 'signup_rejected', 'comment_reply',
  'comment_deleted', 'comment_upvote', 'result_report_resolved',
  'review_flag_resolved'
));
