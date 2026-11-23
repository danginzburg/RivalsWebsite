-- What the bot last read in each match scheduling thread, for the veto import
-- in src/lib/server/discord-bot/thread-sync.ts.
--
-- The thread ↔ match link itself is a discord_posts row (kind 'match_thread'),
-- which the announcement webhooks also read. This table only remembers the
-- newest message seen, so unchanged threads are skipped, and the veto lines the
-- bot last wrote, so a veto an admin typed on the site is never overwritten.

create table if not exists public.discord_thread_vetoes (
  thread_id text primary key,
  match_id uuid references public.matches(id) on delete set null,
  last_message_id text,
  imported_lines jsonb,
  updated_at timestamptz not null default now()
);

-- Server-only: read and written through the service role.
alter table public.discord_thread_vetoes enable row level security;
grant select, insert, update, delete on public.discord_thread_vetoes to service_role;
