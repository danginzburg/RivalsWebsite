import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/public'
import { browser } from '$app/environment'

function createSupabaseClient() {
  if (!browser) {
    return null as unknown as ReturnType<typeof createClient>
  }

  return createClient(
    env.PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
    env.PUBLIC_SUPABASE_ANON_KEY || 'missing-anon-key'
  )
}

export const supabase = createSupabaseClient()
