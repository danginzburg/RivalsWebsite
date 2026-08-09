-- Player signups: registration intake plus the computed rating used by the
-- team balance calculator.

create table if not exists public.player_signups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,

  -- Contact / identity, captured at signup time.
  display_name text,
  discord_handle text,
  -- Array of {label, url} objects so a player can submit more than one tracker.
  tracker_links jsonb not null default '[]'::jsonb,

  -- Formula inputs. Rank names resolve through TEAM_BALANCE_RANKS in app code.
  current_rank text,
  peak_rank text,
  -- Tracker scores are nullable: they are fetched automatically where possible
  -- and entered by hand otherwise.
  tracker_current_score numeric,
  tracker_peak_score numeric,

  -- Formula output. Recomputed whenever an input changes.
  computed_value numeric,
  -- Set when an admin overrides the formula result outright.
  manual_value_override numeric,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by_profile_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One signup per player per season.
  unique (profile_id, season_id)
);

create index if not exists player_signups_profile_idx on public.player_signups(profile_id);
create index if not exists player_signups_season_idx on public.player_signups(season_id);
create index if not exists player_signups_status_idx on public.player_signups(status);

drop trigger if exists player_signups_set_updated_at on public.player_signups;
create trigger player_signups_set_updated_at
  before update on public.player_signups
  for each row execute function public.set_updated_at();

alter table public.player_signups enable row level security;

-- Writes go through the service role, which enforces ownership and admin rules.
-- Reads are restricted; the app exposes only the fields each page needs.
drop policy if exists "player_signups_select" on public.player_signups;
create policy "player_signups_select" on public.player_signups
  for select using (false);

-- Contact details surfaced on player profiles once a signup is approved.
alter table public.profiles
  add column if not exists discord_handle text,
  add column if not exists tracker_links jsonb not null default '[]'::jsonb;
