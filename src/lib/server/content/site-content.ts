import { supabaseAdmin } from '$lib/supabase/admin'
import {
  DEFAULT_SITE_CONTENT,
  normalizeSiteContent,
  type SiteContentKey,
  type SiteContentRecord,
} from '$lib/content/documents'

/**
 * Loads an editable site document, falling back to the built-in default when
 * no version has been saved or the table cannot be read — a public page never
 * fails because of its content row.
 */
export async function loadSiteContent<K extends SiteContentKey>(
  key: K
): Promise<SiteContentRecord<K>> {
  const { data, error } = await supabaseAdmin
    .from('site_content')
    .select('document, updated_at')
    .eq('key', key)
    .maybeSingle()

  if (error || !data) {
    if (error) console.error(`[site-content] failed to load "${key}"`, error.message)
    return { document: structuredClone(DEFAULT_SITE_CONTENT[key]), updatedAt: null }
  }

  return {
    document: normalizeSiteContent(key, data.document),
    updatedAt: data.updated_at as string,
  }
}

export class SiteContentConflictError extends Error {}

const CONFLICT_MESSAGE =
  'Someone else saved this page while you were editing. Reload to see their changes.'

/**
 * Saves a whole document. `expectedUpdatedAt` is the version the editor
 * opened; if someone saved in between, the write is refused instead of
 * silently overwriting their changes.
 */
export async function saveSiteContent<K extends SiteContentKey>(
  key: K,
  document: unknown,
  profileId: string,
  expectedUpdatedAt: string | null
): Promise<SiteContentRecord<K>> {
  const normalized = normalizeSiteContent(key, document)

  const { data: existing, error: readError } = await supabaseAdmin
    .from('site_content')
    .select('updated_at')
    .eq('key', key)
    .maybeSingle()
  if (readError) throw new Error(readError.message)

  const current = (existing?.updated_at as string | undefined) ?? null
  if (current !== expectedUpdatedAt) {
    throw new SiteContentConflictError(CONFLICT_MESSAGE)
  }

  const row = { key, document: normalized, updated_by_profile_id: profileId }
  const query = existing
    ? supabaseAdmin.from('site_content').update(row).eq('key', key).eq('updated_at', current!)
    : supabaseAdmin.from('site_content').insert(row)

  const { data, error } = await query.select('updated_at').maybeSingle()
  if (error) {
    // A concurrent first save trips the primary key.
    if (error.code === '23505') {
      throw new SiteContentConflictError(CONFLICT_MESSAGE)
    }
    throw new Error(error.message)
  }
  if (!data) {
    throw new SiteContentConflictError(CONFLICT_MESSAGE)
  }

  return { document: normalized, updatedAt: data.updated_at as string }
}
