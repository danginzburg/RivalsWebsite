import { error, json, type RequestHandler } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { verifyDiscordSignature } from '$lib/server/discord-bot/verify'
import { handleInteraction, type Interaction } from '$lib/server/discord-bot/interactions'

/**
 * Discord's Interactions Endpoint URL: slash commands and their autocomplete.
 * Every request must carry a valid signature from the application's key,
 * otherwise it is rejected with a 401, as Discord requires. Replies have to
 * arrive within 3 seconds; everything here is a couple of database reads.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const body = await request.text()
  const valid = verifyDiscordSignature(
    body,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
    env.DISCORD_PUBLIC_KEY
  )
  if (!valid) throw error(401, 'Invalid request signature')

  let interaction: Interaction
  try {
    interaction = JSON.parse(body) as Interaction
  } catch {
    throw error(400, 'Invalid JSON')
  }

  try {
    return json(await handleInteraction(interaction, url.origin))
  } catch (err) {
    console.error('Discord interaction failed:', err)
    return json({
      type: 4,
      data: { content: 'Something went wrong on the site. Try again in a minute.', flags: 1 << 6 },
    })
  }
}
