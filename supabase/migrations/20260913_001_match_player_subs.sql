-- Per-match substitute (sub) marking.
--
-- A "sub" is someone who played in a match for a team but is not on that team's
-- season roster. That is derived automatically from team_memberships at read
-- time and needs no storage. This table records only the manual OVERRIDES, for
-- when the roster data is wrong: is_sub = true forces a player to count as a
-- sub, is_sub = false forces them to count as a starter, regardless of roster.
--
-- Stored by source account (PUUID first, else player_name) and match, so it
-- survives a re-import that rewrites player_match_map_stats — the same shape as
-- match_stat_reassignments.

create table if not exists public.match_player_subs (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,

  -- The player's stat rows, identified by their source account. PUUID is
  -- preferred (stable across renames); player_name is the fallback for CSV rows
  -- that carried no PUUID. At least one must be present.
  puuid text,
  player_name text,

  -- The override: true = sub, false = starter. Clearing the override deletes
  -- the row and returns the player to the auto (roster-derived) rule.
  is_sub boolean not null,

  note text,
  created_by_profile_id uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint match_player_subs_key_present
    check (puuid is not null or player_name is not null)
);

-- One override per source account per match. coalesce keeps the two nullable
-- keys in one unique slot, matching match_stat_reassignments.
create unique index if not exists match_player_subs_match_key_unique
  on public.match_player_subs (match_id, coalesce(puuid, player_name));

create index if not exists match_player_subs_match_idx
  on public.match_player_subs (match_id);

drop trigger if exists match_player_subs_set_updated_at on public.match_player_subs;
create trigger match_player_subs_set_updated_at
  before update on public.match_player_subs
  for each row execute function public.set_updated_at();

alter table public.match_player_subs enable row level security;

-- Admin-only, through the service role.
drop policy if exists "match_player_subs_select" on public.match_player_subs;
create policy "match_player_subs_select" on public.match_player_subs
  for select using (false);
