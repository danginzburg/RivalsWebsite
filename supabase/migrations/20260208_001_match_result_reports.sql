-- Match result reporting: captains submit, admins approve.

create table if not exists public.match_result_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  reported_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  reporting_team_id uuid references public.teams(id) on delete set null,
  team_a_score smallint not null default 0,
  team_b_score smallint not null default 0,
  winner_team_id uuid not null references public.teams(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  notes text,
  evidence_url text,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (team_a_score >= 0 and team_b_score >= 0)
);

create index if not exists match_result_reports_match_idx on public.match_result_reports(match_id);
create index if not exists match_result_reports_status_idx on public.match_result_reports(status);

create unique index if not exists match_result_reports_pending_unique
  on public.match_result_reports(match_id)
  where status = 'pending';

drop trigger if exists set_match_result_reports_updated_at on public.match_result_reports;
create trigger set_match_result_reports_updated_at
  before update on public.match_result_reports
  for each row execute procedure public.set_updated_at();

alter table public.match_result_reports enable row level security;

-- Admins only (server uses service role today).
drop policy if exists match_result_reports_admin_read on public.match_result_reports;
create policy match_result_reports_admin_read
  on public.match_result_reports
  for select
  using (public.is_current_user_admin());

drop policy if exists match_result_reports_admin_write on public.match_result_reports;
create policy match_result_reports_admin_write
  on public.match_result_reports
  for all
  using (public.is_current_user_admin())
  with check (public.is_current_user_admin());
