// See env-dynamic-private.ts — same reasoning, kept separate since some transitively-imported
// $lib modules read $env/dynamic/public even though these scripts never exercise that code path.
export const env = process.env as Record<string, string | undefined>
