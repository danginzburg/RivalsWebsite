-- Point the "All Time (NA)" batch at the batches it should aggregate, then
-- rebuild it with `refresh_generated_rivals_group_stats_batch.sql`.
--
-- Why this file exists
-- --------------------
-- "All Time (NA)" is a *generated* batch: its rows are summed from other
-- applied `rivals_group_stats` batches listed in
-- `metadata.source_season_batches`. As of Season 4 it contained Seasons 1-3
-- (regular season + playoffs) plus the Season 4 regular season only — the
-- Season 4 play-ins and playoffs were left out because they were named with
-- square brackets ("Season 4 Playoffs [NA]") and so fell outside the
-- "Season N Playoffs (NA)" naming convention the older name-matching
-- aggregate query relied on. Listing UUIDs explicitly avoids that whole class
-- of problem.
--
-- The double-counting trap
-- ------------------------
-- "Season 4 [NA] Play-ins + Playoffs" (33db3a88…) is exactly the sum of
-- "Season 4 Play-ins [NA]" (130 games) and "Season 4 Playoffs [NA]" (360
-- games). Include EITHER the combined batch OR the two separate ones — never
-- both, or every playoff player's totals double.
--
-- Likewise the "Season 4 [NA] Weeks 1-N" batches are cumulative snapshots of
-- the regular season and are already fully contained in "Season 4 (NA)".
-- They must never appear here.
--
-- EMEA batches are excluded on purpose: this batch is the NA all-time table.
--
-- How to use
-- ----------
-- 1) Decide whether Season 4 Kickoff counts (see the commented line below).
-- 2) Run this statement.
-- 3) Run `supabase/queries/refresh_generated_rivals_group_stats_batch.sql`
--    (already targets the All Time batch id) to delete and re-insert the rows.
-- 4) Spot-check /stats with the "All Time (NA)" batch selected.

update public.stat_import_batches
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object(
       'source_season_batches',
       jsonb_build_array(
         -- Season 1
         'df70872a-82c0-4f06-9ccc-ed122c2bfea4', -- Season 1 (NA)
         'b608880b-050b-4041-8995-54d04b6ebadc', -- Season 1 Playoffs (NA)
         -- Season 2
         'd695bc85-4115-4045-bc49-c179dcc691b8', -- Season 2 (NA)
         '7b292e04-6d76-4663-b651-6e734c093e4e', -- Season 2 Playoffs (NA)
         -- Season 3
         'f6500391-c86f-422c-812a-14817db9f4b1', -- Season 3 (NA)
         'a8a259b9-841d-4ec5-b518-6de923d5f9c2', -- Season 3 Playoffs (NA)
         -- Season 4
         '9d7b560e-9af8-4744-b3e5-6b8894e34ce1', -- Season 4 (NA) — regular season
         '01b97f98-0841-4ce2-8b8c-11c1e3c3dc91', -- Season 4 Play-ins [NA]
         '45326410-2225-4e8f-b8ab-56413412c27c' -- Season 4 Playoffs [NA]
         -- Uncomment to also fold in the off-season Kickoff event:
         , '65ba73f4-1f38-47c3-82b9-2dbd775999a0'  -- Season 4 Kickoff (NA)
       )
     ),
    updated_at = now()
where id = '9bbbf1c1-0a57-4f7c-b0c5-3e1a3f5f05c6'::uuid;

-- Verify before refreshing: every source must be an applied
-- rivals_group_stats batch, or the refresh script aborts.
--
-- select b.display_name, b.status, b.metadata->>'import_type' as import_type
-- from public.stat_import_batches t
-- cross join lateral jsonb_array_elements_text(t.metadata->'source_season_batches') s(id)
-- join public.stat_import_batches b on b.id = s.id::uuid
-- where t.id = '9bbbf1c1-0a57-4f7c-b0c5-3e1a3f5f05c6'::uuid
-- order by b.created_at;
