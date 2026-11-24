-- Confirm-before-replace for vetoes pasted into match scheduling threads.
--
-- The first veto log in a thread is saved straight onto the match. A different
-- log later (a new message, or an edit) doesn't replace it: the bot posts a
-- prompt with "Update veto" / "Keep current" buttons and remembers the offer
-- here until someone answers.

alter table public.discord_thread_vetoes
  -- The veto the open prompt offers, its fingerprint (in the button ids), the
  -- prompt message, and who posted the log (they may answer it).
  add column if not exists pending_lines jsonb,
  add column if not exists pending_hash text,
  add column if not exists pending_message_id text,
  add column if not exists pending_author_id text,
  -- A veto someone chose to keep out, so the same log isn't offered again.
  add column if not exists dismissed_lines jsonb;
