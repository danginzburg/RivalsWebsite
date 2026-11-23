# Discord bot: match events

The bot keeps a Discord **scheduled event** for every upcoming match, in both directions:

| Where the change happens                               | What changes on the other side                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match added on the site                                | An event is created: "Team A vs Team B (Bo3)", at the scheduled time, with the Twitch link as its location ("TBD" until there is one: Discord requires a location) and the match page link as its description. It is created as soon as the match is saved, or once it is within 14 days away. |
| Match edited on the site                               | The event moves, is renamed (if a team changes), or gets the new Twitch link.                                                                                                                                                                                                                  |
| Match cancelled, completed or deleted on the site      | The event is deleted (or marked ended if it is already live).                                                                                                                                                                                                                                  |
| Event created in Discord                               | If its title names two current-season teams ("Sentinels vs Cloud9", "Week 3: SEN vs C9 (Bo5)"), the match is created on the site. If an admin already entered that match within 12 hours of the event's time, the event is linked to it instead. Other events are ignored.                     |
| Event edited in Discord                                | A new start time moves the match. A Twitch link in the location becomes the match's stream.                                                                                                                                                                                                    |
| Event cancelled or deleted in Discord before it starts | The match is marked cancelled.                                                                                                                                                                                                                                                                 |

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
   - Leave every **Privileged Gateway Intent** off. The bot doesn't use the Gateway.

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
