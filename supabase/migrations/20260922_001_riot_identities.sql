-- PUUID identity registry.
--
-- Players rename constantly, which breaks any tracking keyed on a name. The
-- PUUID is the one identifier that survives a rename, and it rides on every
-- player row a Riot match import returns. Until now a PUUID only ever got tied
-- to a profile when someone hand-entered a name#tag that happened to resolve —
-- so a player who renamed before we ever captured their PUUID, or who only
-- shows up under a name that matches nobody, was simply lost.
--
-- This table is the fix: every PUUID we have ever seen in a match gets a row,
-- captured automatically on import, name-independent, whether or not it maps to
-- a profile yet. `latest_name` tracks their current in-game name for free, and
-- `profile_id` stays null until an admin links the identity from the review
-- queue — a one-time action, after which all past and future stats follow the
-- PUUID regardless of what the player renames to.

create table if not exists public.riot_identities (
  -- The Riot PUUID is the identity. One row per PUUID, ever.
  puuid text primary key,

  -- The most recent in-game name/tag we saw this PUUID under. Refreshed on
  -- every import, so it always reflects the player's current name without
  -- anyone editing it. `latest_tag` is null for names that arrived without one
  -- (a legacy CSV base name backfilled below).
  latest_name text,
  latest_tag text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Null = unlinked identity (the admin review queue). Set once an admin ties
  -- this PUUID to a player. `on delete set null` keeps the identity and its
  -- accumulated history if the profile is later removed.
  profile_id uuid references public.profiles(id) on delete set null,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The review queue reads unlinked identities; the profile lookup reads by owner.
create index if not exists riot_identities_unlinked_idx
  on public.riot_identities (last_seen_at desc)
  where profile_id is null;
create index if not exists riot_identities_profile_idx
  on public.riot_identities (profile_id)
  where profile_id is not null;

drop trigger if exists riot_identities_set_updated_at on public.riot_identities;
create trigger riot_identities_set_updated_at
  before update on public.riot_identities
  for each row execute function public.set_updated_at();

alter table public.riot_identities enable row level security;

-- Service-role only, like profile_riot_accounts: all reads/writes go through
-- admin-guarded endpoints that enforce the linking rules.
drop policy if exists "riot_identities_select" on public.riot_identities;
create policy "riot_identities_select" on public.riot_identities
  for select using (false);

-- Promote the PUUID to a first-class, indexed column on the stat rows. It has
-- lived in `metadata->>puuid` for API-imported maps, which means relinking a
-- player's whole history was an unindexed jsonb scan. A real column makes
-- "link once, all history follows" a single indexed update.
alter table public.player_match_map_stats
  add column if not exists puuid text;

create index if not exists player_match_map_stats_puuid_idx
  on public.player_match_map_stats (puuid)
  where puuid is not null;

update public.player_match_map_stats
set puuid = nullif(trim(metadata->>'puuid'), '')
where puuid is null
  and nullif(trim(metadata->>'puuid'), '') is not null;

-- Seed the registry from every PUUID already sitting in the stat history, so
-- the review queue is populated from day one rather than only accruing new
-- imports. Latest name is taken from the most recent map (by match date); the
-- name may carry a tag (Riot import) or be a bare base name (older rows).
insert into public.riot_identities (puuid, latest_name, latest_tag, first_seen_at, last_seen_at, profile_id)
select
  s.puuid,
  split_part((array_agg(coalesce(s.player_name, '') order by m.scheduled_at desc nulls last))[1], '#', 1),
  nullif(split_part((array_agg(coalesce(s.player_name, '') order by m.scheduled_at desc nulls last))[1], '#', 2), ''),
  min(m.scheduled_at),
  max(m.scheduled_at),
  -- If any of this PUUID's rows already carry a profile_id, the identity is
  -- effectively linked already; keep it out of the queue.
  (array_agg(s.profile_id order by (s.profile_id is not null) desc nulls last))[1]
from public.player_match_map_stats s
join public.matches m on m.id = s.match_id
where s.puuid is not null
group by s.puuid
on conflict (puuid) do nothing;

-- Also mark as linked any seeded identity whose PUUID is already a profile's
-- declared identity (profiles.riot_puuid) or an approved Riot account, even if
-- its stat rows were never linked. These must not appear in the review queue.
update public.riot_identities ri
set profile_id = p.id,
    linked_at = coalesce(ri.linked_at, now())
from public.profiles p
where ri.profile_id is null
  and p.riot_puuid is not null
  and p.riot_puuid = ri.puuid;

update public.riot_identities ri
set profile_id = a.profile_id,
    linked_at = coalesce(ri.linked_at, now())
from public.profile_riot_accounts a
where ri.profile_id is null
  and a.status = 'approved'
  and a.riot_puuid is not null
  and a.riot_puuid = ri.puuid;
