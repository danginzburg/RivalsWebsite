/**
 * Register the bot's slash commands with Discord.
 *
 *   npm run discord:register
 *
 * Needs DISCORD_APP_ID and DISCORD_BOT_TOKEN in .env. With DISCORD_GUILD_ID
 * set, the commands are registered on that server only, and changes show up
 * at once. Without it they are registered globally, which can take up to an
 * hour to reach every server. Registering replaces the whole set, so a command
 * removed from COMMANDS disappears.
 */
import { COMMANDS } from '../src/lib/server/discord-bot/commands'

async function main() {
  const appId = process.env.DISCORD_APP_ID?.trim()
  const token = process.env.DISCORD_BOT_TOKEN?.trim()
  const guildId = process.env.DISCORD_GUILD_ID?.trim()
  if (!appId || !token) {
    throw new Error('Set DISCORD_APP_ID and DISCORD_BOT_TOKEN in .env first.')
  }

  const path = guildId
    ? `/applications/${appId}/guilds/${guildId}/commands`
    : `/applications/${appId}/commands`
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(COMMANDS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Discord rejected the commands (${res.status}): ${text}`)

  const registered = JSON.parse(text) as Array<{ name: string }>
  console.log(
    `Registered ${registered.map((c) => `/${c.name}`).join(', ')} ${guildId ? `on server ${guildId}` : 'globally'}.`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
