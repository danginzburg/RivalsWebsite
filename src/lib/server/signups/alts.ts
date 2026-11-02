import { addAltRiotAccount } from '$lib/server/players/riot-accounts'
import { newRiotIdsFromTrackerLinks, riotIdKey } from '$lib/players/tracker-url'
import { supabaseAdmin } from '$lib/supabase/admin'

async function addAlts(profileId: string, riotIds: Array<{ name: string; tag: string }>) {
  const failed: string[] = []

  for (const riotId of riotIds) {
    try {
      await addAltRiotAccount({ profileId, riotName: riotId.name, riotTag: riotId.tag })
    } catch (err) {
      console.warn('addAlts: skipped', riotId, err)
      failed.push(`${riotId.name}#${riotId.tag}`)
    }
  }

  return failed
}

/**
 * Add each tracker link that points at another Riot ID as a pending alt. Links
 * to other sites stay plain links. Never throws: the signup is already saved,
 * so an alt that cannot be added is returned for the player to be told about.
 */
export async function addAltsFromTrackerLinks(
  profileId: string,
  primary: { riotName: string; riotTag: string },
  links: Array<{ url: string }>
): Promise<string[]> {
  const known = [riotIdKey(primary.riotName, primary.riotTag)]
  return addAlts(profileId, newRiotIdsFromTrackerLinks(links, known))
}

/**
 * The same for signups already saved. Riot IDs on the profile in any status are
 * left alone, so a rejected alt stays rejected and a repeat run looks nothing up.
 * Returns the alts that could not be added.
 */
export async function addAltsForSignups(
  signups: Array<{
    id: string
    profile_id: string
    tracker_links: Array<{ url: string }> | null
  }>
): Promise<Array<{ signupId: string; riotId: string }>> {
  const { data, error } = await supabaseAdmin
    .from('riot_accounts')
    .select('profile_id, riot_name, riot_tag')
    .in('profile_id', [...new Set(signups.map((s) => s.profile_id))])
  if (error) throw new Error('Failed to load Riot accounts')

  const known = new Map<string, string[]>()
  for (const a of data ?? []) {
    const keys = known.get(a.profile_id) ?? []
    keys.push(riotIdKey(a.riot_name, a.riot_tag ?? ''))
    known.set(a.profile_id, keys)
  }

  const failures: Array<{ signupId: string; riotId: string }> = []
  for (const signup of signups) {
    const riotIds = newRiotIdsFromTrackerLinks(
      signup.tracker_links ?? [],
      known.get(signup.profile_id) ?? []
    )
    for (const riotId of await addAlts(signup.profile_id, riotIds)) {
      failures.push({ signupId: signup.id, riotId })
    }
  }
  return failures
}
