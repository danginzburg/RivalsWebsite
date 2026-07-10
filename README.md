# Rivals Website

SvelteKit app for Throw City Rivals standings, match pages, pickems, player stats, and admin imports.

## Getting Started

```sh
npm install
npm run dev
```

Useful checks:

```sh
npm run check
npm run lint
npm run test:unit -- --run
npm run test:e2e
```

## Key Areas

- `src/routes/`: SvelteKit pages and API routes. Public pages live directly under `src/routes`; admin pages live under `src/routes/admin`; API handlers live under `src/routes/api`.
- `src/lib/components/`: shared UI, including the main `Header`, page wrapper components, pickem UI, and admin dashboard tabs.
- `src/lib/server/`: server-only domain helpers for auth/session handling, Supabase profile queries, imports, stats, teams, and pickems.
- `src/lib/admin/`: client-side admin API helpers, option lists, and small UI state helpers.
- `src/lib/supabase/`: browser and service-role Supabase clients.
- `supabase/migrations/`: historical schema changes. Treat as append-only once applied.
- `supabase/queries/`: one-off/manual SQL utilities for stats aggregation and repair work.

## Auth And Data

Auth is handled by server routes in `src/routes/auth`. `/auth/login` starts the Auth0 PKCE flow, `/auth/callback` exchanges the code and syncs a Supabase profile, and `/auth/logout` clears the session cookie.

`src/hooks.server.ts` reads the session cookie for every request and exposes `locals.user`. Page server loads and API routes use `locals.user` plus helpers such as `requireAdmin`.

## Imports

Stats imports are centered on `src/lib/components/admin/StatsImport.svelte` and `src/routes/api/admin/stats/+server.ts`. Match imports are centered on `src/routes/admin/matches-import` and `src/routes/api/admin/matches/import/+server.ts`.

Legacy `/add-stats` routes intentionally redirect to `/admin/stats-import` for old bookmarks.
