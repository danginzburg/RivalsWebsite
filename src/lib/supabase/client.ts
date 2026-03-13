import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/public'
import { browser } from '$app/environment'

// Only create client in browser - this file uses Auth0 SPA SDK which is browser-only
function createSupabaseClient() {
  if (!browser) {
    // Return a dummy client for SSR that won't be used
    return null as unknown as ReturnType<typeof createClient>
  }

  const supabaseUrl = env.PUBLIC_SUPABASE_URL
  const anonKey = env.PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY')
  }

  return createClient(supabaseUrl, anonKey)
}

export const supabase = createSupabaseClient()
