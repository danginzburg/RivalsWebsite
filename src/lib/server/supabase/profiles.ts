import { error } from '@sveltejs/kit'
import { supabaseAdmin } from '$lib/supabase/admin'
import { supabaseErrorMessageIncludes } from '$lib/server/supabase/errors'

type Order = { column: string; ascending: boolean }

/**
 * If `profiles.riot_id_base` is missing in the DB, retry without that column and attach `riot_id_base: null`.
 */
export async function queryProfilesWithOptionalRiotIdBase<
  Row extends { riot_id_base?: string | null },
>(args: {
  selectWithRiot: string
  selectWithoutRiot: string
  order: Order
  fatalMessage: string
}): Promise<Row[]> {
  const { data, error: err } = await supabaseAdmin
    .from('profiles')
    .select(args.selectWithRiot)
    .order(args.order.column, { ascending: args.order.ascending })

  if (!err) {
    return (data ?? []) as unknown as Row[]
  }

  if (!supabaseErrorMessageIncludes(err, 'riot_id_base')) {
    console.error(err)
    throw error(500, args.fatalMessage)
  }

  const { data: fallback, error: fallbackError } = await supabaseAdmin
    .from('profiles')
    .select(args.selectWithoutRiot)
    .order(args.order.column, { ascending: args.order.ascending })

  if (fallbackError) {
    console.error(fallbackError)
    throw error(500, args.fatalMessage)
  }

  return (fallback ?? []).map((p) => ({
    ...(p as unknown as Record<string, unknown>),
    riot_id_base: null,
  })) as Row[]
}
