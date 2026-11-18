-- The old match result reports, replaced by public.match_reports (captain
-- submissions). Nothing in the app reads or writes this table any more, and it
-- is already gone from the live project; this keeps a replay of the migrations
-- (supabase db reset, preview branches) in line with it.

drop table if exists public.match_result_reports;
