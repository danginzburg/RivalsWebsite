-- The Discord bot opens each match's scheduling thread itself.
--
-- teams.discord_role_id: the team's Discord role, pinged when its match thread
-- is opened or its opponent changes. Fill it in by hand once the role exists
-- (Developer Mode on → right-click the role → Copy Role ID). A team without
-- one is named in bold instead of pinged.
--
-- discord_thread_vetoes is the bot's per-thread state (see
-- src/lib/server/discord-bot/thread-sync.ts). New columns:
--   team_ids          the two teams the thread was last about, to notice an
--                     opponent being swapped on the match
--   since_message_id  only messages after this one count for the veto, so a
--                     veto from before an opponent change isn't imported
--   created_by_bot    the bot opened (or adopted) the thread, so it may rename it
--   orphaned_at       the thread's match was deleted; a replacement match
--                     created soon after takes the thread over
--   closed_at         the bot locked and archived the thread

alter table public.teams
  add column if not exists discord_role_id text
    check (discord_role_id is null or discord_role_id ~ '^\d{5,25}$');

alter table public.discord_thread_vetoes
  add column if not exists team_ids jsonb,
  add column if not exists since_message_id text,
  add column if not exists created_by_bot boolean not null default false,
  add column if not exists orphaned_at timestamptz,
  add column if not exists closed_at timestamptz;

create index if not exists discord_thread_vetoes_orphaned_idx
  on public.discord_thread_vetoes (orphaned_at)
  where orphaned_at is not null;
