-- Discord messages the site has posted through channel webhooks.
--
-- One row per (kind, subject, channel): a reschedule, a corrected score or a
-- renamed team edits the message recorded here instead of posting again, and
-- one-off posts (reminders, alerts) use the row to avoid posting twice.
--
-- `subject_id` is text because it is not always a single row id: reminders key
-- on "<match id>:<start time>" so a rescheduled match gets a new reminder.
--
-- `thread_id` is set for messages that live inside a forum thread. The Discord
-- bot also stores each match's r5-match-scheduling thread here as
-- kind = 'match_thread', channel = 'scheduling'.
--
-- `message_id` is null while a post is being sent (the row is claimed first so
-- two concurrent requests cannot both post).

create table if not exists public.discord_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  subject_id text not null,
  channel text not null,
  message_id text,
  thread_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_posts_kind_subject_channel_key unique (kind, subject_id, channel)
);

create index if not exists discord_posts_subject_idx on public.discord_posts (subject_id);

alter table public.discord_posts enable row level security;

-- Supabase no longer auto-grants new tables (since 2026-10-30). Server only.
grant select, insert, update, delete on public.discord_posts to service_role;
