// $env/dynamic/private only resolves inside SvelteKit's Vite runtime.
// scripts/ run under plain tsx, so this shim stands in for it and reads process.env directly.
export const env = process.env as Record<string, string | undefined>
