import { mdsvex } from 'mdsvex'
import adapter from '@sveltejs/adapter-vercel'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Lets a component keep its styles in a sibling file via
 * `<style src="./page.css"></style>`. The file is inlined before compiling,
 * so the CSS stays scoped to the component exactly like an inline block.
 * @type {import('svelte/compiler').PreprocessorGroup}
 */
const externalStyles = {
  name: 'external-styles',
  style({ attributes, filename }) {
    if (typeof attributes.src !== 'string' || !filename) return
    const path = resolve(dirname(filename), attributes.src)
    const { src: _src, ...rest } = attributes
    return { code: readFileSync(path, 'utf8'), dependencies: [path], attributes: rest }
  },
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // Deployed on Vercel. Functions are serverless, so per-process memory
    // (caches, the HenrikDev pacer) is per instance; durable limits live in
    // Postgres (see $lib/server/rate-limit).
    adapter: adapter(),
  },

  preprocess: [mdsvex(), externalStyles],
  extensions: ['.svelte', '.svx'],
}

export default config
