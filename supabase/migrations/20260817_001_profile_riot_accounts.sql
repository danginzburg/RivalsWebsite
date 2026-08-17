-- Riot accounts owned by a profile: primary plus any alts/subs.
--
-- Identity has drifted between three name columns (profiles.display_name,
-- riot_id_base, stats_player_name) and match imports match against all of them
-- by name. A Riot rename breaks that until the name is hand-edited. This table
-- makes the PUUID — the one identifier that survives a rename — the canonical
-- match key, and gives a player more than one Riot ID that all pool into the
-- same profile.

create table if not exists public.profile_riot_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,

  -- Name before '#', and the tag after it. Stored split because Riot APIs take
  -- the pair while stat rows are usually keyed on the base name alone.
  riot_name text not null,
  riot_tag text not null,
  -- Null until the account is verified against the Riot account API. Once set,
  -- it is the preferred match key over any name.
  riot_puuid text,

  -- Exactly one account per profile is the primary — the identity the signup
  -- form manages and the default source of the chosen display name.
  is_primary boolean not null default false,

  -- Primary accounts are the player's own declared identity (auto-approved).
  -- Alts are added self-serve and sit pending until an admin approves, so a
  -- griefer cannot claim another player's name to poison stat matching.
  status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),

  -- Optional free-text note, e.g. "smurf" or "sub for TeamX".
  label text,
  verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Riot ID belongs to exactly one profile.
create unique index if not exists profile_riot_accounts_name_tag_unique
  on public.profile_riot_accounts (lower(riot_name), lower(riot_tag));

-- A PUUID identifies exactly one account.
create unique index if not exists profile_riot_accounts_puuid_unique
  on public.profile_riot_accounts (riot_puuid)
  where riot_puuid is not null;

-- At most one primary per profile.
create unique index if not exists profile_riot_accounts_one_primary
  on public.profile_riot_accounts (profile_id)
  where is_primary;

create index if not exists profile_riot_accounts_profile_idx
  on public.profile_riot_accounts (profile_id);
create index if not exists profile_riot_accounts_puuid_idx
  on public.profile_riot_accounts (riot_puuid);

drop trigger if exists profile_riot_accounts_set_updated_at on public.profile_riot_accounts;
create trigger profile_riot_accounts_set_updated_at
  before update on public.profile_riot_accounts
  for each row execute function public.set_updated_at();

alter table public.profile_riot_accounts enable row level security;

-- Reads and writes go through the service role, which enforces ownership and
-- admin approval rules; nothing is exposed to anon/auth roles directly.
drop policy if exists "profile_riot_accounts_select" on public.profile_riot_accounts;
create policy "profile_riot_accounts_select" on public.profile_riot_accounts
  for select using (false);

-- Backfill one approved primary account per profile that already declared a
-- Riot ID, so the table is the source of truth from the first deploy. The tag
-- may be unknown for older profiles; store an empty string rather than null so
-- the not-null constraint holds, and let a later signup/verify fill it in.
insert into public.profile_riot_accounts
  (profile_id, riot_name, riot_tag, riot_puuid, is_primary, status, verified_at)
select
  p.id,
  p.riot_id_base,
  coalesce(p.riot_tag, ''),
  p.riot_puuid,
  true,
  'approved',
  p.riot_verified_at
from public.profiles p
where p.riot_id_base is not null
  and not exists (
    select 1 from public.profile_riot_accounts a where a.profile_id = p.id
  )
-- Skip a name whose lower(name,tag) key already exists (defensive against
-- duplicate riot_id_base across profiles); those are resolved by hand later.
on conflict do nothing;
