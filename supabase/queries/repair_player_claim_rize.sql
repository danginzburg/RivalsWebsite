-- One-off repair: link unclaimed roster/match/leaderboard rows for player name "rize"
-- to claimed profile 49a4217d-7052-4cfe-a6b3-6d521a46b2b6.
-- Run in Supabase SQL editor (or psql) after reviewing. Prefer the app's claimRelinkAfterProfileUpdate
-- for conflict-safe behavior; use this for emergency DBA repair.
--
-- Manual verification checklist:
-- 1) team_memberships: at most one active row for this profile_id; no stray active name-only "rize"
--    on the same team as the linked membership.
-- 2) player_match_map_stats: no null profile_id rows for base name rize (see query in step 3 comment).
-- 3) rivals_group_stats: rematch + update applied; player_name rows point at profile_id.
-- 4) Rebuild series aggregates: from app, call rebuildPlayerMatchStats(match_id) for each distinct
--    match_id touched in player_match_map_stats (or use admin tooling).

begin;

-- 0) Duplicate name-only slot on same team as an existing linked membership: deactivate placeholder
update public.team_memberships tm
set is_active = false,
    left_at = coalesce(tm.left_at, current_date)
where tm.profile_id is null
  and tm.is_active = true
  and tm.left_at is null
  and lower(trim(tm.player_name)) = 'rize'
  and exists (
    select 1
    from public.team_memberships existing
    where existing.profile_id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'::uuid
      and existing.is_active = true
      and existing.left_at is null
      and existing.team_id = tm.team_id
  );

-- 1) Link name-only rows only when the claimed profile has no active membership yet
--    (unique partial index team_memberships_active_profile_unique allows one active team only).
update public.team_memberships tm
set profile_id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'::uuid
where tm.profile_id is null
  and tm.is_active = true
  and tm.left_at is null
  and lower(trim(tm.player_name)) = 'rize'
  and not exists (
    select 1
    from public.team_memberships x
    where x.profile_id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'::uuid
      and x.is_active = true
      and x.left_at is null
  );

-- 2) Match map stats
update public.player_match_map_stats pm
set profile_id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'::uuid
where pm.profile_id is null
  and lower(trim(split_part(pm.player_name, '#', 1))) = 'rize';

-- 3) Leaderboard: RPC then any remaining name rows
select * from public.rematch_rivals_group_stats(null);

update public.rivals_group_stats r
set profile_id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'::uuid
where r.profile_id is null
  and lower(trim(split_part(r.player_name, '#', 1))) = 'rize';

-- Rebuild player_match_stats per match in application (see plan). Example:
-- select distinct match_id from public.player_match_map_stats
-- where profile_id = '49a4217d-7052-4cfe-a6b3-6d521a46b2b6'::uuid;

commit;
