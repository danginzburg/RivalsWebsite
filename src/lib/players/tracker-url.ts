/**
 * A player's tracker.gg profile URL.
 *
 * Built from the current Riot ID rather than a stored URL, so it follows
 * renames along with the account. Shared by the profile panel and the signup
 * form's prefill so both link to the same page.
 */
export function trackerProfileUrl(
  riotName: string | null | undefined,
  riotTag: string | null | undefined
): string | null {
  if (!riotName || !riotTag) return null
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(
    `${riotName}#${riotTag}`
  )}/overview`
}
