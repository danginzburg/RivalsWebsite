import { createClient } from '@supabase/supabase-js'
import { env } from '$env/dynamic/private'

const supabaseUrl = env.SUPABASE_URL || 'http://127.0.0.1:54321'
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key'

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})
