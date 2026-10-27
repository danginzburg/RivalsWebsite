-- One home for player identity.
--
-- A player's identity had drifted across six places: the `profiles.riot_*`
-- columns (riot_id_base, riot_tag, riot_puuid, riot_verified_at,
-- stats_player_name), `profile_riot_accounts` (primary + alts),
-- `riot_identities` (every PUUID seen in a match, with an admin-set name for
-- players who never logged in), plus Discord details split between the login
-- session, the profile and each signup. Every lookup had to know which of them
-- to consult, and in which order.
--
-- After this migration:
--   * `riot_accounts` holds every Riot ID and PUUID we know about — owned by a
--     profile (primary, alts, name aliases) or not yet owned by anyone (the
--     admin review queue, `profile_id is null`).
--   * `profiles` holds the person: display name, login, Discord id/username.
--   * `player_signups` holds only per-season submissions (ranks, scores,
--     contact details as submitted, review status).
--   * `player_directory` joins the two into one row per player for lookups.
--
-- The old tables and columns are left in place, unread and unwritten, so this
-- can be applied before the app is deployed. They are dropped by hand
-- afterwards with supabase/queries/drop_legacy_identity_columns.sql.

create table if not exists public.riot_accounts (
  id uuid primary key default gen_random_uuid(),

  -- Null = nobody owns this account yet (seen in a match, awaiting an admin
  -- link). `set null` keeps the account and its history if a profile goes.
  profile_id uuid references public.profiles(id) on delete set null,

  -- Name before '#', and the tag after it. The tag is null for a bare name
  -- (a legacy CSV name or a stats alias) that never came with one.
  riot_name text not null,
  riot_tag text,
  -- The rename-proof key. Null for an account that was never resolved against
  -- Riot (e.g. a name alias); imports backfill it when they can.
  puuid text,

  -- The player's main account: the one the signup form manages and the
  -- default source of their display name.
  is_primary boolean not null default false,
  -- Self-added alts wait for an admin before their stats pool in.
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  label text,

  -- Admin-chosen name for an account nobody owns yet. Shown on stats instead
  -- of the Riot name, and adopted as the profile's display name on linking.
  display_name text,

  verified_at timestamptz,
  -- Match-import sightings, refreshed on every import that carries the PUUID.
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (not is_primary or profile_id is not null)
);

-- A plain constraint (nulls stay distinct) rather than a partial index, so
-- imports can upsert on it.
alter table public.riot_accounts
  drop constraint if exists riot_accounts_puuid_key;
alter table public.riot_accounts
  add constraint riot_accounts_puuid_key unique (puuid);

-- A Riot ID belongs to one player. Unowned accounts are exempt: a name freed by
-- a rename can legitimately be seen on a second PUUID.
create unique index if not exists riot_accounts_owned_name_tag_unique
  on public.riot_accounts (lower(riot_name), lower(coalesce(riot_tag, '')))
  where profile_id is not null;

create unique index if not exists riot_accounts_one_primary
  on public.riot_accounts (profile_id)
  where is_primary;

create index if not exists riot_accounts_profile_idx
  on public.riot_accounts (profile_id)
  where profile_id is not null;
create index if not exists riot_accounts_unowned_idx
  on public.riot_accounts (last_seen_at desc)
  where profile_id is null;
create index if not exists riot_accounts_name_idx
  on public.riot_accounts (lower(riot_name));

drop trigger if exists riot_accounts_set_updated_at on public.riot_accounts;
create trigger riot_accounts_set_updated_at
  before update on public.riot_accounts
  for each row execute function public.set_updated_at();

alter table public.riot_accounts enable row level security;

-- Service-role only; every read and write goes through guarded endpoints.
drop policy if exists "riot_accounts_select" on public.riot_accounts;
create policy "riot_accounts_select" on public.riot_accounts
  for select using (false);

-- ---------------------------------------------------------------------------
-- Backfill. Order matters: the richest source first, and each later step only
-- fills in what the earlier ones did not already record.
-- ---------------------------------------------------------------------------

-- 1. Every profile-owned account, keeping its id.
insert into public.riot_accounts
  (id, profile_id, riot_name, riot_tag, puuid, is_primary, status, label,
   verified_at, created_at, updated_at)
select
  a.id, a.profile_id, a.riot_name, nullif(trim(a.riot_tag), ''), a.riot_puuid,
  a.is_primary, a.status, a.label, a.verified_at, a.created_at, a.updated_at
from public.profile_riot_accounts a
on conflict do nothing;

-- 2. Fold in the PUUID registry. Sightings and the admin name go onto the
-- account that already carries the PUUID...
update public.riot_accounts ra
set first_seen_at = ri.first_seen_at,
    last_seen_at = ri.last_seen_at,
    display_name = ri.display_name,
    linked_by = ri.linked_by,
    linked_at = ri.linked_at
from public.riot_identities ri
where ra.puuid = ri.puuid;

-- ...or onto the same player's name-matched account that never got a PUUID.
update public.riot_accounts ra
set puuid = ri.puuid,
    first_seen_at = ri.first_seen_at,
    last_seen_at = ri.last_seen_at,
    linked_by = ri.linked_by,
    linked_at = ri.linked_at
from public.riot_identities ri
where ra.puuid is null
  and ri.profile_id = ra.profile_id
  and lower(ra.riot_name) = lower(coalesce(ri.latest_name, ''))
  and lower(coalesce(ra.riot_tag, '')) = lower(coalesce(ri.latest_tag, ''))
  and not exists (select 1 from public.riot_accounts x where x.puuid = ri.puuid);

-- Linked identities with no account row become an account of their own.
insert into public.riot_accounts
  (profile_id, riot_name, riot_tag, puuid, status, label, display_name,
   verified_at, first_seen_at, last_seen_at, linked_by, linked_at, created_at)
select
  ri.profile_id, coalesce(nullif(trim(ri.latest_name), ''), ri.puuid),
  nullif(trim(ri.latest_tag), ''), ri.puuid, 'approved',
  case when ri.profile_id is not null then 'Linked by admin' end, ri.display_name,
  ri.linked_at, ri.first_seen_at, ri.last_seen_at, ri.linked_by, ri.linked_at, ri.created_at
from public.riot_identities ri
where not exists (select 1 from public.riot_accounts x where x.puuid = ri.puuid)
on conflict do nothing;

-- Anything the insert above skipped (its name was already another account of
-- the same player) is kept unowned rather than lost; it reappears in the queue.
insert into public.riot_accounts
  (riot_name, riot_tag, puuid, status, display_name, first_seen_at, last_seen_at, created_at)
select
  coalesce(nullif(trim(ri.latest_name), ''), ri.puuid), nullif(trim(ri.latest_tag), ''),
  ri.puuid, 'approved', ri.display_name, ri.first_seen_at, ri.last_seen_at, ri.created_at
from public.riot_identities ri
where not exists (select 1 from public.riot_accounts x where x.puuid = ri.puuid);

-- 3. Riot details that only ever reached the profile columns.
update public.riot_accounts ra
set puuid = p.riot_puuid,
    verified_at = coalesce(ra.verified_at, p.riot_verified_at)
from public.profiles p
where ra.profile_id = p.id
  and ra.is_primary
  and ra.puuid is null
  and p.riot_puuid is not null
  and not exists (select 1 from public.riot_accounts x where x.puuid = p.riot_puuid);

insert into public.riot_accounts
  (profile_id, riot_name, riot_tag, puuid, is_primary, status, verified_at)
select
  p.id, coalesce(p.riot_id_base, p.riot_puuid), nullif(trim(p.riot_tag), ''), p.riot_puuid,
  not exists (select 1 from public.riot_accounts x where x.profile_id = p.id and x.is_primary),
  'approved', p.riot_verified_at
from public.profiles p
where (p.riot_id_base is not null or p.riot_puuid is not null)
  and not exists (
    select 1 from public.riot_accounts x
    where x.profile_id = p.id
      and (x.puuid = p.riot_puuid
        or (x.puuid is null and lower(x.riot_name) = lower(coalesce(p.riot_id_base, ''))))
  )
  and (p.riot_puuid is null
    or not exists (select 1 from public.riot_accounts x where x.puuid = p.riot_puuid))
on conflict do nothing;

-- The stats alias name becomes a tagless account, so name matching has one
-- list to read.
insert into public.riot_accounts (profile_id, riot_name, status, label)
select p.id, trim(p.stats_player_name), 'approved', 'Stats name alias'
from public.profiles p
where nullif(trim(p.stats_player_name), '') is not null
  and not exists (
    select 1 from public.riot_accounts x
    where x.profile_id = p.id and lower(x.riot_name) = lower(trim(p.stats_player_name))
  )
on conflict do nothing;

-- 4. Every player with an approved account has a primary.
update public.riot_accounts ra
set is_primary = true
from (
  select distinct on (profile_id) id
  from public.riot_accounts
  where profile_id is not null and status = 'approved'
  order by profile_id, (puuid is not null) desc, created_at
) first_account
where ra.id = first_account.id
  and not exists (
    select 1 from public.riot_accounts x where x.profile_id = ra.profile_id and x.is_primary
  );

-- ---------------------------------------------------------------------------
-- Discord lives on the profile, captured at login.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists discord_id text,
  add column if not exists discord_username text;

create unique index if not exists profiles_discord_id_unique
  on public.profiles (discord_id)
  where discord_id is not null;

-- Auth0 namespaces a Discord login's subject as "oauth2|discord|<snowflake>".
update public.profiles
set discord_id = split_part(auth0_sub, '|', 3)
where discord_id is null
  and auth0_sub ilike 'oauth2|discord|%'
  and split_part(auth0_sub, '|', 3) <> '';

-- Display names were seeded from riot_id_base; any profile still without one
-- takes its primary Riot name, so nothing needs the old column as a fallback.
update public.profiles p
set display_name = ra.riot_name
from public.riot_accounts ra
where ra.profile_id = p.id
  and ra.is_primary
  and nullif(trim(p.display_name), '') is null;

-- ---------------------------------------------------------------------------
-- Name rematch for imported group stats reads the new table.
-- ---------------------------------------------------------------------------

create or replace function public.rematch_rivals_group_stats(batch_id uuid default null)
returns table (updated_count integer, remaining_unmatched integer)
language plpgsql
as $$
declare
  v_updated integer := 0;
  v_remaining integer := 0;
begin
  update public.rivals_group_stats r
  set profile_id = a.profile_id
  from public.riot_accounts a
  where r.profile_id is null
    and a.profile_id is not null
    and a.status = 'approved'
    and lower(trim(split_part(r.player_name, '#', 1))) = lower(trim(a.riot_name))
    and (batch_id is null or r.import_batch_id = batch_id);

  get diagnostics v_updated = row_count;

  select count(*)
  into v_remaining
  from public.rivals_group_stats r
  where r.profile_id is null
    and (batch_id is null or r.import_batch_id = batch_id);

  updated_count := v_updated;
  remaining_unmatched := v_remaining;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- One row per player, for lookups.
-- ---------------------------------------------------------------------------

create or replace view public.player_directory
with (security_invoker = true) as
select
  p.id as profile_id,
  p.display_name,
  p.display_name_is_custom,
  p.email,
  p.avatar_url,
  p.role,
  p.discord_id,
  p.discord_username,
  primary_account.riot_name,
  primary_account.riot_tag,
  primary_account.puuid,
  coalesce(accounts.puuids, '{}') as puuids,
  coalesce(accounts.riot_ids, '{}') as riot_ids,
  latest_signup.season_id as latest_signup_season_id,
  latest_signup.status as latest_signup_status,
  latest_signup.discord_handle as latest_signup_discord_handle
from public.profiles p
left join lateral (
  select a.riot_name, a.riot_tag, a.puuid
  from public.riot_accounts a
  where a.profile_id = p.id and a.is_primary
) primary_account on true
left join lateral (
  select
    array_agg(a.puuid order by a.is_primary desc, a.created_at)
      filter (where a.puuid is not null) as puuids,
    array_agg(
      case when a.riot_tag is null then a.riot_name else a.riot_name || '#' || a.riot_tag end
      order by a.is_primary desc, a.created_at
    ) as riot_ids
  from public.riot_accounts a
  where a.profile_id = p.id and a.status = 'approved'
) accounts on true
left join lateral (
  select s.season_id, s.status, s.discord_handle
  from public.player_signups s
  where s.profile_id = p.id
  order by s.updated_at desc
  limit 1
) latest_signup on true;
