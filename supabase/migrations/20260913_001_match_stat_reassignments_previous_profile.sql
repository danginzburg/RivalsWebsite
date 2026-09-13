-- Backfill the previous_profile_id column onto match_stat_reassignments.
--
-- The original 20260817_004 migration was applied before previous_profile_id
-- was added to that file, and `create table if not exists` never alters an
-- existing table. The deployed table was therefore missing the column, so every
-- reassignment insert (which always writes previous_profile_id) failed with
-- "column ... does not exist" and surfaced as a 500 on the match page. This
-- adds the column idempotently so the table matches the code.
--
-- previous_profile_id records who owned the stat rows before an override, so
-- clearing the override restores the original credit. Null when the rows were
-- previously unassigned.

alter table public.match_stat_reassignments
  add column if not exists previous_profile_id uuid
    references public.profiles(id) on delete set null;
