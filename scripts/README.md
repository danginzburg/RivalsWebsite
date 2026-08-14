# One-off Google Sheets import scripts

These scripts import a season's historical matches, leaderboard, and player stats from two
Google Sheets workbooks into Supabase. They are not part of the app build — they run under
`tsx` against this repo's server-side helpers directly (no HTTP server required).

Requires a `.env` file at the repo root with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
(same as the app uses). Each `npm run sheets:*` script passes `--env-file=.env` to `tsx`.

## Stage order

1. `npm run sheets:fetch` — downloads both workbooks (cached under `scripts/.cache/`, pass
   `--fresh` to force re-download), parses them, writes `scripts/out/wb1.json` and `wb2.json`.
2. `npm run sheets:resolve` — matches sheet team codes/player names against existing DB rows,
   merges results into `scripts/data/aliases.teams.json` and `aliases.players.json`. Review
   these files by hand afterward — especially the `PLACEHOLDER-NEEDS-REVIEW` team names for
   JRB/SFC/PH/CALM, which must be edited to real names/tags before applying. Pass `--force` to
   re-resolve entries you've already hand-edited (normally it never clobbers them).
3. `npm run sheets:series` — filters to regular season, drops FFW/FFL forfeit rows, pairs each
   team tab's mirrored rows into one record per series, writes `scripts/out/series.json`.
4. `npm run sheets:join` — attaches workbook 2's per-map tabs to each series (by footer metadata,
   falling back to roster overlap, with manual overrides from `scripts/data/tab-overrides.json`),
   writes `scripts/out/joined.json` (import-ready payloads).
5. `npm run sheets:dry-run` — read-only: checks which series already exist as matches, tallies
   blockers/soft issues, writes `scripts/out/dry-run.md` for human review.
6. `npm run sheets:apply` — creates any placeholder teams from `aliases.teams.json`, then calls
   `importCompletedSeries` for each series. Supports `--only <seriesKey>`, `--limit <n>`, and
   `--rollback` (prints what a rollback would touch; re-running apply is idempotent and safe).
7. `npm run sheets:import-agg` — imports the Leaderboard tab and the aggregate stats tab by
   invoking the admin API route handlers directly. Supports `--replace-batch` to delete the most
   recent `rivals_group_stats` import batch before inserting (useful on retry).

All the `sheets:*` scripts accept `--admin <profileId>` to pick which admin profile/auth identity
to act as, instead of auto-selecting the first `role = 'admin'` profile with an `auth0_sub` set.

## Filling signup ranks and tracker scores

`npm run signups:fill-tracker` runs the same lookup as the admin dashboard's bulk-import button,
but from this machine and writing straight to Supabase. Use it when the deployed site reports
"tracker.gg refused the request".

Cloudflare challenges the requests that miss its cache and reach tracker's origin, which is most
often the old act a player peaked in. The client retries a block twice; anything still refused is
reported and picked up by simply running the command again, since filled rows are skipped.

```
npm run signups:fill-tracker -- --dry-run          # show what would change, write nothing
npm run signups:fill-tracker                       # fill blanks on pending signups
npm run signups:fill-tracker -- --active-season    # only the active season's signups
npm run signups:fill-tracker -- --overwrite        # refresh values that are already set
```

Flags: `--source riot|tracker|both` (default `both`), `--status <status>|all` (default `pending`),
`--season <uuid>` or `--season __none__`, `--active-season`, `--limit <n>`, `--overwrite`,
`--dry-run`. It never touches `manual_value_override`, and `computed_value` is recomputed from
whatever it fills.
