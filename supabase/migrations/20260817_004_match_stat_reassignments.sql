-- Per-match manual stat reassignment: a one-off override, not a permanent link.
--
-- Case: a player competed on someone else's tracked account for a single match
-- and wants the stats credited to their own profile, without the two accounts
-- being linked. Default matching (by PUUID, then name) still runs on import;
-- these overrides are applied last, so they win on top and — because they are
-- stored by match — survive a re-import that would otherwise reset profile_id
-- to the account's real owner.

create table if not exists public.match_stat_reassignments (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,

  -- The stat rows to move, identified by their source account. PUUID is
  -- preferred (stable across renames); player_name is the fallback for rows
  -- imported from a CSV that carried no PUUID. At least one must be present.
  puuid text,
  player_name text,

  -- The profile the stats should be credited to for this match.
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- Who owned the rows before this override, captured when it was created, so
  -- removing the override restores the original credit without re-running the
  -- whole match's matching. Null when the rows were previously unassigned.
  previous_profile_id uuid references public.profiles(id) on delete set null,

  note text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint match_stat_reassignments_key_present
    check (puuid is not null or player_name is not null)
);

-- One override per source account per match. coalesce keeps the two nullable
-- keys in one unique slot: a puuid-keyed override and a name-keyed override for
-- the same player would be distinct rows, which is intended.
create unique index if not exists match_stat_reassignments_match_key_unique
  on public.match_stat_reassignments (match_id, coalesce(puuid, player_name));

create index if not exists match_stat_reassignments_match_idx
  on public.match_stat_reassignments (match_id);
create index if not exists match_stat_reassignments_profile_idx
  on public.match_stat_reassignments (profile_id);

drop trigger if exists match_stat_reassignments_set_updated_at on public.match_stat_reassignments;
create trigger match_stat_reassignments_set_updated_at
  before update on public.match_stat_reassignments
  for each row execute function public.set_updated_at();

alter table public.match_stat_reassignments enable row level security;

-- Admin-only, through the service role.
drop policy if exists "match_stat_reassignments_select" on public.match_stat_reassignments;
create policy "match_stat_reassignments_select" on public.match_stat_reassignments
  for select using (false);
