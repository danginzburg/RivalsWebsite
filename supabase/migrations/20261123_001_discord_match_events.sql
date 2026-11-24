-- Links each match to its Discord scheduled event, for the two-way sync in
-- src/lib/server/discord-events. Each row also stores both sides as they were
-- at the last sync, so the sync can tell which side changed since.
--
-- A row is "open" while the pair is being kept in step and closed once the
-- match is over or the event is gone. A match can collect several closed rows
-- (an event deleted, then a new one after a reschedule) but only one open row.

create table if not exists public.discord_match_events (
  guild_event_id text primary key,
  guild_id text not null,
  -- Set null when the match is deleted, so the next run can take its event down.
  match_id uuid references public.matches(id) on delete set null,
  -- Which side made the event: the site, or someone in Discord.
  origin text not null default 'site' check (origin in ('site', 'discord')),
  site_start timestamptz,
  site_twitch_url text,
  site_teams_key text,
  event_start timestamptz,
  event_location text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists discord_match_events_one_open_per_match
  on public.discord_match_events (match_id)
  where closed_at is null and match_id is not null;

create index if not exists discord_match_events_match_idx
  on public.discord_match_events (match_id);

-- Server-only: read and written through the service role.
alter table public.discord_match_events enable row level security;
grant select, insert, update, delete on public.discord_match_events to service_role;
