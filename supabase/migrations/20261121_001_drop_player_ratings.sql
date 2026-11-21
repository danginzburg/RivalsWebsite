-- The externally calculated sheet ratings that fed the old signup bonus.
-- Signup scores now come from the site's own league stats
-- (src/lib/server/signups/performance-model.ts), so nothing reads this table.

drop table if exists public.player_ratings;
