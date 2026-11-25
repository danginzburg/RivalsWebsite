-- Undo a local DISCORD_DRY_RUN test of roster announcements.
--
-- Dry-run sends nothing to Discord but still records each "post" with a fake
-- message id. Left in place, those rows would make the site think a team was
-- already announced, so the real Announce would edit a message that doesn't
-- exist. Run this after testing, before publishing for real.

begin;

-- Publishes made while testing: only teams whose roster card was a dry run.
delete from public.team_roster_announcements
where team_id::text in (
  select subject_id from public.discord_posts
  where kind = 'team_roster' and message_id like 'dry-run-%'
);

-- Every post recorded during dry-run (any channel), so none of them block a real post.
delete from public.discord_posts where message_id like 'dry-run-%';

commit;
