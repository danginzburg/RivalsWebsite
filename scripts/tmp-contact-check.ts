import { supabaseAdmin } from './lib/db'

const { data } = await supabaseAdmin
  .from('profiles')
  .select('id')
  .not('discord_handle', 'is', null)
  .limit(1)
  .maybeSingle()

console.log(data?.id ?? '')
