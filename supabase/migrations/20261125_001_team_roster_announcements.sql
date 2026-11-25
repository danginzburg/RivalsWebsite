-- Roster changes an admin has published to Discord.
--
-- Roster edits on the site post nothing by themselves. An admin publishes the
-- difference between the live roster and the last published one; each publish
-- is a row here. The newest row per team is "what Discord was last told", so a
-- mistake that is undone before publishing never shows up anywhere.
--
--   kind = 'initial'  the team's first publish: posts the team to
--                     #team-creation with its starting roster.
--   kind = 'update'   a later publish: one #team-updates post, and one line in
--                     the creation post's change history.
--
-- `roster` is the full roster after this publish; `changes` is what changed
-- from the previous row (empty for 'initial'). `previous_id` chains the rows,
-- and its unique constraint stops a double-click from publishing twice.

create table if not exists public.team_roster_announcements (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- No cascade: only the newest row is ever deleted (a correction that undid a
  -- whole update), so nothing may point at a row that goes.
  previous_id uuid references public.team_roster_announcements (id),
  kind text not null check (kind in ('initial', 'update')),
  roster jsonb not null default '[]'::jsonb,
  changes jsonb not null default '[]'::jsonb,
  published_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_roster_announcements_chain_key unique nulls not distinct (team_id, previous_id)
);

create index if not exists team_roster_announcements_team_idx
  on public.team_roster_announcements (team_id, created_at);

alter table public.team_roster_announcements enable row level security;

-- Supabase no longer auto-grants new tables (since 2026-10-30). Server only.
grant select, insert, update, delete on public.team_roster_announcements to service_role;
