-- Explicit Data API grants for tables created after 2026-10-30.
--
-- Supabase no longer auto-grants supabase-js/PostgREST access to new tables in
-- "public". These tables work on the live project today, but replaying the
-- migrations (supabase db reset, preview branches) would leave them unreachable.
-- Safe to re-run: granting an existing privilege is a no-op.

-- Public leaderboard records: read by everyone (RLS policy "stat_records_select"),
-- written by the server through the service role.
grant select on public.stat_records to anon, authenticated;
grant select, insert, update, delete on public.stat_records to service_role;

-- Admin overrides: read and written through the service role only.
grant select, insert, update, delete on public.stat_record_overrides to service_role;
