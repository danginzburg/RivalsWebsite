import { mdsvex } from 'mdsvex'
import adapter from '@sveltejs/adapter-vercel'

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Deployed on Vercel. Functions are serverless, so per-process memory
    // (caches, the HenrikDev pacer) is per instance; durable limits live in
    // Postgres (see $lib/server/rate-limit).
    adapter: adapter(),
  },

  preprocess: [mdsvex()],
  extensions: ['.svelte', '.svx'],
}

export default config
