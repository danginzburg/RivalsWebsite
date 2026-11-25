# Discord announcements

The site posts to Discord automatically through channel **webhooks**: one URL per channel, send-only.
Reading messages (veto import, linking forum threads to matches) is the Discord bot's job, not this module's.

| Channel                     | Env var                         | What is posted                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #match-results              | `DISCORD_WEBHOOK_RESULTS`       | Final result when a match is finalized, imported (CSV, Riot or no-show forfeit) or auto-applied from a captain report: score, map scores, MVP (top ACS), the match card image. Re-importing or correcting edits the post.                                   |
| r5-match-scheduling (forum) | `DISCORD_WEBHOOK_SCHEDULING`    | Into each match's thread: scheduled, then edited on reschedule or cancellation; a "match day" reminder that morning. Skipped until a thread is linked.                                                                                                      |
| #vods                       | `DISCORD_WEBHOOK_VODS`          | `TAG vs TAG` / stage / `MM/DD/YYYY` / VOD link, when a VOD URL is set on a completed match.                                                                                                                                                                 |
| #team-logos                 | `DISCORD_WEBHOOK_TEAM_LOGOS`    | Team name, tag and logo when a team is approved (or created by an admin). Later edits update the post.                                                                                                                                                      |
| #team-creation              | `DISCORD_WEBHOOK_TEAM_CREATION` | A team's roster card (captain, players, subs, coaches, managers), posted when an admin clicks **Announce team**. Edited on every published update, with a dated **Change history**.                                                                         |
| #team-updates               | `DISCORD_WEBHOOK_TEAM_UPDATES`  | One post per roster update an admin **publishes**: joined, left, role changed. Roster edits alone post nothing.                                                                                                                                             |
| #official-streams           | `DISCORD_WEBHOOK_STREAMS`       | "LIVE" when a stream's status is set to live, pinging the @Stream Ping role. Edited to "ended" afterwards.                                                                                                                                                  |
| #prod-announcements         | `DISCORD_WEBHOOK_PROD`          | A stream link was added to a match.                                                                                                                                                                                                                         |
| #rivals-annoucements        | `DISCORD_WEBHOOK_ANNOUNCEMENTS` | Pick'em open, "locks today" that morning, locked (when an admin locks it), and the final standings when an admin sets the pick'em to "Final now": the winner (or everyone tied), the top 5+ with points, and a standings card (`/og/pickem/[eventId].png`). |
| private staff channel       | `DISCORD_WEBHOOK_ADMIN`         | Bug reports, captain result submissions held for review, reported comments.                                                                                                                                                                                 |

Every `DISCORD_*` variable also works without the prefix (`WEBHOOK_RESULTS`, `STREAM_PING_ROLE_ID`, `DRY_RUN`, …) for hosts that refuse names containing "discord". A channel without a URL is skipped. Only the **active season** posts, so backfills and edits to old seasons stay quiet.

## Setup

1. In Discord: channel settings → **Integrations → Webhooks → New Webhook** → copy the URL. For
   r5-match-scheduling, create the webhook on the forum channel itself.
2. Set the env vars above in Vercel (Project → Settings → Environment Variables) and in your local `.env`.
   **Never commit webhook URLs**: anyone with one can post as it.
3. Role ids (@Stream Ping, @Rivals Player, …) live in `DISCORD_ROLES` in `config.ts`, not env: they aren't secrets.
   Add a role there (Developer Mode on → right-click the role → Copy Role ID). Each role's `env` name
   (e.g. `DISCORD_STREAM_PING_ROLE_ID`) still overrides its id if set, for swapping one without a deploy.
4. `SITE_URL`: the public site origin, e.g. `https://tcrivals.gg`, used for links and images
   (falls back to Vercel's production URL).
5. Apply `supabase/migrations/20261123_001_discord_posts.sql`.

### Daily reminders (cron)

Once a day at 10 AM Eastern (`vercel.json`, `0 15 * * *` UTC, so 11 AM during daylight saving),
`GET /api/cron/discord` posts:

- **Match day** in the thread of each match still to play today (until midnight Central), @mentioning
  every rostered player with a linked Discord account (`profiles.discord_id`). Bot DMs to each player
  are implemented but switched off (`REMINDER_DMS_ENABLED` in `announce.ts`) until there is an opt-in.
- **Pick'em locks today** for an open pick'em that locks before midnight Central
- **Weekly standings** on Mondays, in #rivals-annoucements: every ranked team's record, map record,
  round difference and movement since a week ago (▲/▼, 🆕 for a team's first series), the week's biggest
  climb, and the standings card. Skipped between seasons and after a week with no regular-season series.
  It pings @Rivals Player (switch off with `WEEKLY_STANDINGS_PING` in `announce.ts`).

Set `CRON_SECRET` in Vercel: Vercel Cron sends it as `Authorization: Bearer $CRON_SECRET`, and the endpoint
rejects calls without it. A daily cron works on the Hobby plan. Running it again never double-posts.

### Roster announcements

Roster edits never post on their own, so a wrong role or a mis-added player that is fixed before publishing
never reaches Discord. Each team card on the admin Teams tab has a **Discord Roster** box showing the
difference between the live roster and the last published one (`team_roster_announcements`):

- **Announce team**: the first publish. Posts the roster card to #team-creation.
- **Publish to #team-updates**: posts the pending changes, and edits the #team-creation card's roster and
  change history.
- **Correct last post**: re-does the newest publish against the live roster, editing its posts instead of
  sending new ones. If the corrected update no longer changes anything, its post is deleted.

Apply `supabase/migrations/20261125_001_team_roster_announcements.sql`.

## Local testing

`DISCORD_DRY_RUN=1` logs every payload (with the webhook token redacted) instead of sending it, and works
without any webhook URLs set. Posts are still recorded in `discord_posts`, so edits show up as `PATCH`.

## How it works

- `webhook.ts`: the HTTP client. 3s timeout, one retry on 429, never throws.
- `embeds.ts`: pure payload builders (tested in `embeds.test.ts`).
- `posts.ts`: the `discord_posts` table. One row per (kind, subject, channel): edits the existing message,
  reposts if someone deleted it, and claims the row first so concurrent requests don't double-post.
- `announce.ts`: loads data and posts. Callers use `inBackground(...)` (Vercel `waitUntil`), so Discord never
  slows down or breaks the action that triggered it.

The notification events in `$lib/server/notifications/events.ts` take `{ announce: false }` for any rebuild,
backfill or re-import path that reuses them.

**For the Discord bot:** link a forum thread to its match by upserting a `discord_posts` row with
`kind = 'match_thread'`, `subject_id = <match id>`, `channel = 'scheduling'`, `thread_id = <thread id>`.
