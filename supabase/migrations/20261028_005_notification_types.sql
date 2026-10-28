-- Widen the notification feed beyond moderation outcomes: match scheduling and
-- results for rostered players, roster changes, alt-account reviews,
-- accolades, and pick'em open/scored announcements.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'signup_approved', 'signup_rejected', 'comment_reply',
  'comment_deleted', 'comment_upvote', 'result_report_resolved',
  'review_flag_resolved', 'bug_report_resolved',
  'riot_account_reviewed', 'accolade_awarded', 'team_roster_added',
  'match_scheduled', 'match_result', 'match_cancelled',
  'pickem_opened', 'pickem_scored'
));
