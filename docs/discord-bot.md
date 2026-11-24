# Discord bot

The bot does two jobs: it keeps match **events** in step with the site (below), and it handles the **match scheduling threads** (see [Match scheduling threads](#match-scheduling-threads)).

## Match events

The bot keeps a Discord **scheduled event** for every upcoming match, in both directions:

| Where the change happens                               | What changes on the other side                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match added on the site                                | An event is created: "Team A vs Team B (Bo3)", at the scheduled time, with the Twitch link as its location ("TBD" until there is one: Discord requires a location) and the match page link as its description. It is created as soon as the match is saved, or once it is within 14 days away.                                                                                            |
| Match edited on the site                               | The event moves, is renamed (if a team changes), or gets the new Twitch link.                                                                                                                                                                                                                                                                                                             |
| Match cancelled, completed or deleted on the site      | The event is deleted (or marked ended if it is already live).                                                                                                                                                                                                                                                                                                                             |
| Event created in Discord                               | If its title names two current-season teams ("Sentinels vs Cloud9", "Week 3: SEN vs C9 (Bo5)"), the match is created on the site. Team names and tags are matched ignoring spaces, case and punctuation, so "test 1" finds a team named "test1". If an admin already entered that match within 12 hours of the event's time, the event is linked to it instead. Other events are ignored. |
| Event edited in Discord                                | A new start time moves the match. A Twitch link in the location becomes the match's stream.                                                                                                                                                                                                                                                                                               |
| Event cancelled or deleted in Discord before it starts | The match is marked cancelled.                                                                                                                                                                                                                                                                                                                                                            |

Site edits reach Discord immediately. Discord edits reach the site within about a minute, because Discord only announces event changes over a live Gateway connection, which Vercel can't hold. Instead, Supabase calls `/api/discord/sync` every minute and the site compares both sides.

If both sides change the same field between two runs, the Discord edit wins.

The code is in `src/lib/server/discord-events/` (`plan.ts` decides, `sync.ts` applies). The link table is `discord_match_events`.

## 1. Set up the application

Use the Discord application you already made for Auth0 login. A bot added to it leaves login alone: the Client ID, Client Secret and redirect URLs stay the same. (Or click **New Application** at https://discord.com/developers/applications for a separate one.)

1. Under **Installation**, set **Install Link** to **None** and save. Do this first: Discord won't make the bot private while a default install link is set. The invite URL below does the install, and login is unaffected.
2. Under **Bot**:
   - Click **Reset Token**, copy the token and keep it for `DISCORD_BOT_TOKEN`. Discord shows it only once. This doesn't change the Client Secret that Auth0 uses.
   - Turn off **Public Bot**, so only you can add it to servers.
   - Leave **Requires OAuth2 Code Grant** off.
   - Under **Privileged Gateway Intents**, turn on **Message Content Intent**. The bot needs it to read veto logs pasted into scheduling threads. Leave the other two off.

## 2. Invite the bot to your server

Open this URL, with your application id from **General Information → Application ID** in place of `YOUR_APP_ID`:

```
https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=17600775979008
```

`17600775979008` grants **Create Events** and **Manage Events**, and nothing else. The bot needs Manage Events to edit and delete events, including ones people make by hand.

Then get the server id: in Discord, go to **User Settings → Advanced** and turn on **Developer Mode**. Right-click the server icon and choose **Copy Server ID**. That is `DISCORD_GUILD_ID`.

## 3. Set environment variables

Add these in Vercel (**Project → Settings → Environment Variables**), for **Production only**. Preview deployments then leave Discord alone. Never commit the values.

| Variable              | Value                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`   | The bot token from step 1                                                                               |
| `DISCORD_GUILD_ID`    | The server id from step 2                                                                               |
| `DISCORD_SYNC_SECRET` | A long random string. Generate one with `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `SITE_URL`            | The public site address, e.g. `https://tcrivals.com`. Event links use it.                               |

Redeploy so the variables take effect. Until both `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` are set, the sync does nothing, which is why local dev doesn't touch Discord.

## 4. Apply the migration

Run `supabase/migrations/20261123_001_discord_match_events.sql` in the Supabase SQL editor, or with `supabase db push`.

## 5. Schedule the every-minute run

In the Supabase dashboard, open **Integrations** and enable **Cron** (`pg_cron`) and **pg_net**. Then run this in the SQL editor with your own values. It's kept out of the migrations because it contains the secret.

```sql
select vault.create_secret('PASTE_DISCORD_SYNC_SECRET', 'discord_sync_secret');

select cron.schedule(
  'discord-event-sync',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_SITE/api/discord/sync',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'discord_sync_secret')
    ),
    timeout_milliseconds := 30000
  );
  $$
);
```

To check it's working:

```sql
-- Recent runs and their HTTP status (200 is good, 401 is a wrong secret).
select id, status_code, content::text, created from net._http_response order by created desc limit 5;
```

Each response is a JSON report, for example `{"configured":true,"created":2,"updated":0,"closed":0,"imported":0,"adopted":0,"errors":[]}`.

You can also trigger a run by hand:

```powershell
curl.exe -X POST https://YOUR_SITE/api/discord/sync -H "Authorization: Bearer YOUR_SECRET"
```

To pause the sync: `select cron.unschedule('discord-event-sync');`. Site edits will still push to Discord as long as the bot variables are set.

## Things to know

- Anyone with **Manage Events** or **Create Events** permission in your server can create and move matches through Discord. Grant those permissions to staff only.
- Matches created from Discord are approved, in the active season, best of 3 unless the title or description says "Bo5". The creator is recorded on the match if their Discord account is linked to a site profile.
- The bot only manages events in the server set by `DISCORD_GUILD_ID`.
- Deleting an event in Discord only cancels the match if the event hadn't started yet. Events that end on their own are just unlinked.

## Match scheduling threads

Teams open one thread per match in the **r5-match-scheduling** forum to agree a time and run the map veto. The bot:

- **Links each thread to its match.** A thread titled with the two teams ("Sentinels vs Cloud9", "SEN vs C9", "Week 3: SEN vs C9") is linked to those teams' next open match within a minute. For any other title, run **`/link-match`** inside the thread and pick the match from the list. Running it again re-links the thread. The bot confirms each link with a message in the thread. Once linked, the announcement webhooks post that match's schedule updates into the thread.
- **Sets a match's time with `/set-time`** (staff only). For a match entered without a time, or to move one, run `/set-time date:<day> time:<time>` inside its linked thread. The date accepts "Fri", "tomorrow", "11/28" or "Nov 28", and the time "7pm", "7:30 PM" or "19:30", all in **Central time** (daylight saving handled). Both fields suggest values as you type. Saving does what the site's match editor does: the match page gets the time, both rosters are notified, the thread's schedule post is created or edited, and the Discord event is created or moved. The event appears once the match is within 14 days. The bot replies with the time as a Discord timestamp, so everyone reads it in their own time zone. Only members with **Manage Threads**, **Manage Events** or **Administrator** can use it; anyone else gets a private refusal, and so does a time in the past or a completed or cancelled match.
- **Copies the veto onto the match.** Paste the veto bot's log into the thread, in one message or a few back-to-back ones, plain or in a code block:

  ```
  25. Oct.2026 23:06:23 UTC: Team 1 (SEN) bans Map "Sunset"!
  25. Oct.2026 23:07:02 UTC: Team 1 (SEN) picks Map "Ascent"!
  25. Oct.2026 23:07:30 UTC: Team 2 (C9) picked "Attacker" as Side to start on Map "Ascent"!
  25. Oct.2026 23:08:10 UTC: Map "Lotus" will be decider!
  ```

  Or type the veto by hand, in one message or one line per message:

  ```
  VP Bans Lotus
  NVG Bans Fracture
  VP Picks Pearl (NVG Def)
  NVG Pick Haven (VP Atk)
  VP Ban Split
  Nvg ban ascent
  Breeze remains (VP Atk)
  ```

  The rules for a hand-typed veto:
  - **Bans and picks** are `<team> ban <map>` or `<team> pick <map>`, with ban/bans/banned and pick/picks/picked all accepted.
  - **Teams** are the match's two teams, by tag or name.
  - **Maps** come from the season's map pool (**Admin → Seasons → Map Pool**). Without a pool, any seven distinct competitive maps count.
  - **Matching** ignores case, spaces and punctuation in team and map names.
  - **Sides:** a note in brackets, `(VP Atk)` or `(NVG Def)`, gives the side that team starts on for that map. Atk/Att/Attack/Attacker and Def/Defense/Defender all work. A line on its own such as `VP Atk breeze` says the same thing.
  - **The decider** is `Breeze remains`, `Breeze decider`, `decider Breeze` or `Breeze is the decider`, with an optional side note.
  - **It only counts when complete:** every map in the pool exactly once, one decider, at least one pick, both teams taking part, and no side on a banned map or sides that contradict each other. Anything less is treated as chat, so talk such as "we pick haven?" never sets a veto.

  Within a minute, the match page shows it and the bot replies "✅ Veto saved" with the veto it read. Chat around the veto is ignored. If both forms are in a thread, the newest one wins.

- **Asks before replacing a saved veto.** If a different log shows up later (a new message, or an edit to the first one), the veto isn't changed. The bot posts the new veto with **Update veto** and **Keep current** buttons and pings whoever posted it. Only that person or staff (Manage Threads, Manage Messages or Administrator) can press them, so nothing changes from someone typing "yes" in the chat. After **Keep current**, the same log isn't offered again; a different one is. If the new log is removed or put back as it was, the prompt says it no longer applies. A veto an admin typed on the site is never replaced from Discord.

The code is in `src/lib/server/discord-bot/`. The link is a `discord_posts` row (`kind = 'match_thread'`) that the webhooks read too. `discord_thread_vetoes` remembers what the bot last read.

### Setup

1. **Message Content Intent.** Turn it on under **Bot** (see step 1 above). Without it the bot sees empty messages and imports nothing.
2. **Let the bot read the forum.** Open the **r5-match-scheduling** forum's settings, go to **Permissions**, add the bot's role, and allow **View Channel**, **Read Message History** and **Send Messages in Threads**. (Or re-invite it with `scope=bot%20applications.commands&permissions=17875653952512`, which adds those three permissions server-wide.)
3. **Get the forum's id.** With Developer Mode on, right-click the forum and choose **Copy Channel ID**.
4. **Add two more Vercel variables** (Production), then redeploy:

   | Variable                      | Value                                                                       |
   | ----------------------------- | --------------------------------------------------------------------------- |
   | `DISCORD_PUBLIC_KEY`          | **General Information → Public Key** in the Developer Portal                |
   | `DISCORD_SCHEDULING_FORUM_ID` | The forum's channel id from step 3. Leave it unset to turn thread sync off. |

5. **Apply the migrations.** Run `supabase/migrations/20261124_001_discord_thread_vetoes.sql`, then `20261124_002_discord_thread_veto_prompts.sql`. The `discord_posts` table comes from the announcements work (`20261123_001_discord_posts.sql`); apply that first, because thread linking writes to it.
6. **Set the Interactions Endpoint URL.** After the redeploy, go to **General Information** and set **Interactions Endpoint URL** to `https://YOUR_SITE/api/discord/interactions`, then save. Discord sends a signed test request; if it says the URL couldn't be verified, `DISCORD_PUBLIC_KEY` is missing or wrong. This doesn't affect Auth0 login.
7. **Register the commands** (`/link-match` and `/set-time`). In your local `.env`, add `DISCORD_APP_ID` (the Application ID), `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`, then run:

   ```powershell
   npm run discord:register
   ```

   It prints `Registered /link-match, /set-time on server …`. Run it after the deploy that adds a command, so the command works as soon as it appears. With `DISCORD_GUILD_ID` set the command appears at once; without it, it's registered globally and can take up to an hour. Run it again whenever the commands change.

The minute sync's report gains a `threads` part, for example `"threads":{"configured":true,"linked":1,"vetoes":0,"prompts":0,"errors":[]}`. `prompts` counts "Update veto?" prompts posted or refreshed.

Anyone who can post in a scheduling thread can run `/link-match` there. The bot's reply is public, so a wrong link is easy to spot and fix by running it again. To limit it to staff, go to **Server Settings → Integrations → the bot → /link-match** and pick the roles that can use it.
