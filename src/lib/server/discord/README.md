# Discord announcements

The site posts to Discord automatically through channel **webhooks**: one URL per channel, send-only.
Reading messages (veto import, linking forum threads to matches) is the Discord bot's job, not this module's.

| Channel                     | Env var                         | What is posted                                                                                                                                    |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| #match-results              | `DISCORD_WEBHOOK_RESULTS`       | Final result: score, map scores, MVP (top ACS), the match card image. A corrected score edits the post.                                           |
| r5-match-scheduling (forum) | `DISCORD_WEBHOOK_SCHEDULING`    | Into each match's thread: scheduled, then edited on reschedule or cancellation; "starting soon" an hour before. Skipped until a thread is linked. |
| #vods                       | `DISCORD_WEBHOOK_VODS`          | `TAG vs TAG` / stage / `MM/DD/YYYY` / VOD link, when a VOD URL is set on a completed match.                                                       |
| #team-logos                 | `DISCORD_WEBHOOK_TEAM_LOGOS`    | Team name, tag and logo when a team is approved (or created by an admin). Later edits update the post.                                            |
| #official-streams           | `DISCORD_WEBHOOK_STREAMS`       | "LIVE" when a stream's status is set to live, pinging `DISCORD_STREAM_PING_ROLE_ID`. Edited to "ended" afterwards.                                |
| #prod-announcements         | `DISCORD_WEBHOOK_PROD`          | A stream link was added to a match.                                                                                                               |
| #rivals-annoucements        | `DISCORD_WEBHOOK_ANNOUNCEMENTS` | Pick'em open, locks in 1 hour, locked, and the season's pick'em winner once every pick'em result is in (the grand final).                         |
| private staff channel       | `DISCORD_WEBHOOK_ADMIN`         | Bug reports, captain result submissions held for review, reported comments.                                                                       |

Every `DISCORD_*` variable also works without the prefix (`WEBHOOK_RESULTS`, `STREAM_PING_ROLE_ID`, `DRY_RUN`, …) for hosts that refuse names containing "discord". A channel without a URL is skipped. Only the **active season** posts, so backfills and edits to old seasons stay quiet.

## Setup

1. In Discord: channel settings → **Integrations → Webhooks → New Webhook** → copy the URL. For
   r5-match-scheduling, create the webhook on the forum channel itself.
2. Set the env vars above in Vercel (Project → Settings → Environment Variables) and in your local `.env`.
   **Never commit webhook URLs**: anyone with one can post as it.
3. `DISCORD_STREAM_PING_ROLE_ID`: the @Stream Ping role's id (Developer Mode on → right-click the role → Copy Role ID).
4. `SITE_URL`: the public site origin, e.g. `https://tcrivals.gg`, used for links and images
   (falls back to Vercel's production URL).
5. Apply `supabase/migrations/20261123_001_discord_posts.sql`.

### Reminders (cron)

`GET /api/cron/discord` posts the "starting soon" reminders and the pick'em lock warning/locked posts.
It needs `CRON_SECRET` set, and checks `Authorization: Bearer $CRON_SECRET`. Run it every 15 minutes:

- **Vercel Pro**: add to `vercel.json`, and Vercel sends the header itself:
  ```json
  { "crons": [{ "path": "/api/cron/discord", "schedule": "*/15 * * * *" }] }
  ```
  Vercel Hobby only allows daily crons (and fails the deploy otherwise), so this isn't committed.
- **Otherwise**: any external pinger (cron-job.org, a GitHub Actions schedule) calling the URL with that header.

Repeated runs never double-post.

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
