-- Captain result submissions.
--
-- After a match, a captain of either team pastes the veto log and the
-- tracker.gg links from the match page. A clean submission (links only, every
-- map's lobby resolves to this match's two teams, a score that fits the
-- best-of) imports straight away and is kept here as an audit row with status
-- 'applied'. Anything unusual — a forfeited map, a note for admins, rosters
-- that don't line up, a match that already has stats — waits as 'pending' for
-- an admin to approve or reject. The veto is display-only and is saved onto
-- the match immediately either way.

create table if not exists public.match_reports (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  -- The captain's team; null when an admin submitted from the match page.
  team_id uuid references public.teams(id) on delete set null,
  submitted_by_profile_id uuid references public.profiles(id) on delete set null,
  status text not null check (status in ('applied', 'pending', 'rejected')),
  tracker_input text not null default '',
  region text not null default 'na',
  veto_lines text[] not null default '{}',
  -- Hand-entered forfeited map, in the importer's ForfeitMapSpec shape.
  forfeit_map jsonb,
  note text,
  -- Why the submission was held for review; empty for one that applied itself.
  review_reasons text[] not null default '{}',
  -- The dry-run preview (teams, map scores, unmatched players) at submit time.
  preview jsonb,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists match_reports_match_idx
  on public.match_reports (match_id, created_at desc);
create index if not exists match_reports_pending_idx
  on public.match_reports (created_at desc)
  where status = 'pending';

-- Read and written through the service role only.
alter table public.match_reports enable row level security;

-- Supabase no longer auto-grants new tables (since 2026-10-30).
grant select, insert, update, delete on public.match_reports to service_role;
