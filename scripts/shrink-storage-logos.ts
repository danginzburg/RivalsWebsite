// One-off: shrink every logo already in the `team-logos` bucket and give it a
// one-year cache header.
//
// Why: the logos were stored as uploaded (up to 2MB PNGs) with Supabase's
// default `max-age=3600`, so every visitor re-downloaded megabytes of logos
// each hour. That's what was maxing out cached egress. New uploads are shrunk in
// the browser and get a one-year cache (see src/lib/server/logo-upload.ts); this
// fixes the objects that came before.
//
// Each object is rewritten in place at the same path, so no database rows
// change and every existing URL keeps working. Originals are saved to
// scripts/backups/logos-<timestamp>/ first, so the rewrite can be undone.
//
// Usage:
//   npx tsx --env-file=.env --tsconfig scripts/tsconfig.json scripts/shrink-storage-logos.ts           # dry run
//   npx tsx --env-file=.env --tsconfig scripts/tsconfig.json scripts/shrink-storage-logos.ts --apply   # write
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { supabaseAdmin } from './lib/db'

const BUCKET = 'team-logos'
const MAX_DIMENSION = 256
// Keep in sync with LOGO_CACHE_CONTROL in src/lib/server/logo-upload.ts.
const CACHE_CONTROL = '31536000'
const APPLY = process.argv.includes('--apply')

type StoredObject = { path: string; size: number; mimetype: string; cacheControl: string }

async function listAll(prefix = ''): Promise<StoredObject[]> {
  const found: StoredObject[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(prefix, { limit: 1000, offset })
    if (error) throw error
    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!entry.id) {
        found.push(...(await listAll(fullPath)))
      } else {
        found.push({
          path: fullPath,
          size: Number(entry.metadata?.size ?? 0),
          mimetype: String(entry.metadata?.mimetype ?? ''),
          cacheControl: String(entry.metadata?.cacheControl ?? ''),
        })
      }
    }
    if (data.length < 1000) break
  }
  return found
}

async function main() {
  const objects = await listAll()
  const backupDir = path.join(
    'scripts',
    'backups',
    `logos-${new Date().toISOString().replace(/[:.]/g, '-')}`
  )
  if (APPLY) mkdirSync(backupDir, { recursive: true })

  let before = 0
  let after = 0
  let rewritten = 0

  for (const obj of objects) {
    before += obj.size
    const alreadyDone = obj.cacheControl === `max-age=${CACHE_CONTROL}` && obj.size < 64 * 1024
    if (alreadyDone || obj.mimetype === 'image/svg+xml' || obj.mimetype === 'image/gif') {
      after += obj.size
      continue
    }

    const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(obj.path)
    if (error || !blob) {
      console.warn(`skip ${obj.path}: download failed`, error?.message)
      after += obj.size
      continue
    }
    const original = Buffer.from(await blob.arrayBuffer())

    let output: Buffer
    let contentType: string
    try {
      const shrunk = await sharp(original)
        .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90, effort: 6 })
        .toBuffer()
      // Already-tiny files can grow when re-encoded; keep those bytes and only fix the header.
      if (shrunk.length < original.length) {
        output = shrunk
        contentType = 'image/webp'
      } else {
        output = original
        contentType = obj.mimetype || 'application/octet-stream'
      }
    } catch (err) {
      console.warn(`skip ${obj.path}: not a decodable image`, (err as Error).message)
      after += obj.size
      continue
    }

    after += output.length
    rewritten++
    console.log(
      `${(original.length / 1024).toFixed(0).padStart(6)}KB -> ${(output.length / 1024).toFixed(0).padStart(4)}KB  ${obj.path}`
    )

    if (!APPLY) continue

    const backupPath = path.join(backupDir, obj.path)
    mkdirSync(path.dirname(backupPath), { recursive: true })
    writeFileSync(backupPath, original)

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(obj.path, output, { contentType, cacheControl: CACHE_CONTROL, upsert: true })
    if (uploadError) console.error(`FAILED ${obj.path}:`, uploadError.message)
  }

  console.log(
    `\n${objects.length} objects, ${rewritten} ${APPLY ? 'rewritten' : 'would be rewritten'}: ` +
      `${(before / 1e6).toFixed(2)}MB -> ${(after / 1e6).toFixed(2)}MB`
  )
  if (APPLY) console.log(`Originals saved to ${backupDir}`)
  else console.log('Dry run. Pass --apply to write.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
