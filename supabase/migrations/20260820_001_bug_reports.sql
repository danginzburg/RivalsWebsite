-- Site-wide "I found a bug" reports, submitted from a global button in the layout.
--
-- Unlike review_flags (which point at a specific match or profile), a bug report
-- is general: it carries the page the user was on plus a free-text description.
-- Admins triage it from the Moderation tab and mark it resolved/dismissed.
-- Reads/writes go through the service role; RLS stays closed.

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- The route the reporter was on when they opened the form, e.g. "/matches/abc".
  -- Nullable because a report is still useful without it.
  page_path text,
  description text not null,
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'dismissed')),
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bug_reports_status_idx on public.bug_reports(status);
create index if not exists bug_reports_created_at_idx on public.bug_reports(created_at desc);

drop trigger if exists bug_reports_set_updated_at on public.bug_reports;
create trigger bug_reports_set_updated_at
  before update on public.bug_reports
  for each row execute function public.set_updated_at();

alter table public.bug_reports enable row level security;

-- The app serves bug reports only to admins through the service role.
drop policy if exists "bug_reports_select" on public.bug_reports;
create policy "bug_reports_select" on public.bug_reports
  for select using (false);

-- Let the notification feed carry a "your bug report was reviewed" event.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'signup_approved', 'signup_rejected', 'comment_reply',
  'comment_deleted', 'comment_upvote', 'result_report_resolved',
  'review_flag_resolved', 'bug_report_resolved'
));
