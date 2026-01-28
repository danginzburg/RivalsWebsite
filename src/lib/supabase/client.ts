import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { browser } from '$app/environment'

// Only create client in browser - this file uses Auth0 SPA SDK which is browser-only
function createSupabaseClient() {
  if (!browser) {
    // Return a dummy client for SSR that won't be used
    return null as unknown as ReturnType<typeof createClient>
  }

  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
}

export const supabase = createSupabaseClient()
