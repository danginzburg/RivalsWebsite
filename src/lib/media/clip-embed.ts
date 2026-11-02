/**
 * Turn a pasted clip link into something a page can play inline.
 *
 * Only providers whose embed URLs are documented and stable are recognised;
 * anything else (Medal, Twitter, a Discord attachment...) stays a plain
 * "Watch clip" link, which always works.
 */

export type ClipProvider = 'youtube' | 'twitch' | 'streamable'

export type ClipEmbed = {
  provider: ClipProvider
  providerLabel: string
  /**
   * Builds the iframe src. Twitch refuses to play unless told which site is
   * embedding it, so the hostname is only known in the browser.
   */
  embedUrl: (hostname: string) => string
  /** Poster shown before the player loads, when the provider publishes one. */
  thumbnailUrl: string | null
  /** Vertical video (YouTube Shorts) — shown in a taller frame. */
  isVertical: boolean
}

/** "1h2m3s", "90s", "90" → seconds. */
function parseStartTime(value: string | null): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!m || !m[0]) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

function youtube(url: URL): ClipEmbed | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, '')
  let id: string | null = null
  let isVertical = false

  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0] || null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, value] = url.pathname.split('/')
    if (kind === 'watch') id = url.searchParams.get('v')
    else if (kind === 'shorts') {
      id = value ?? null
      isVertical = true
    } else if (kind === 'embed' || kind === 'live') id = value ?? null
  }
  if (!id || !/^[\w-]{6,}$/.test(id)) return null

  const start = parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'))
  const params = new URLSearchParams({ autoplay: '1', rel: '0' })
  if (start) params.set('start', String(start))
  const src = `https://www.youtube-nocookie.com/embed/${id}?${params}`

  return {
    provider: 'youtube',
    providerLabel: 'YouTube',
    embedUrl: () => src,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    isVertical,
  }
}

function twitch(url: URL): ClipEmbed | null {
  const host = url.hostname.replace(/^(www\.|m\.)/, '')
  const parts = url.pathname.split('/').filter(Boolean)

  // clips.twitch.tv/<slug>  or  twitch.tv/<channel>/clip/<slug>
  const clipSlug =
    host === 'clips.twitch.tv'
      ? parts[0]
      : host === 'twitch.tv' && parts[1] === 'clip'
        ? parts[2]
        : null
  if (clipSlug) {
    return {
      provider: 'twitch',
      providerLabel: 'Twitch',
      embedUrl: (hostname) =>
        `https://clips.twitch.tv/embed?${new URLSearchParams({ clip: clipSlug, parent: hostname, autoplay: 'true' })}`,
      thumbnailUrl: null,
      isVertical: false,
    }
  }

  // twitch.tv/videos/<id>?t=1h2m3s
  if (host === 'twitch.tv' && parts[0] === 'videos' && /^\d+$/.test(parts[1] ?? '')) {
    const videoId = parts[1]
    const time = url.searchParams.get('t')
    return {
      provider: 'twitch',
      providerLabel: 'Twitch',
      embedUrl: (hostname) => {
        const params = new URLSearchParams({
          video: `v${videoId}`,
          parent: hostname,
          autoplay: 'true',
        })
        if (time) params.set('time', time)
        return `https://player.twitch.tv/?${params}`
      },
      thumbnailUrl: null,
      isVertical: false,
    }
  }

  return null
}

function streamable(url: URL): ClipEmbed | null {
  if (url.hostname.replace(/^www\./, '') !== 'streamable.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const id = parts[0] === 'e' ? parts[1] : parts[0]
  if (!id || !/^\w+$/.test(id)) return null
  return {
    provider: 'streamable',
    providerLabel: 'Streamable',
    embedUrl: () => `https://streamable.com/e/${id}?autoplay=1`,
    thumbnailUrl: null,
    isVertical: false,
  }
}

/** The embed for a clip link, or null when it can only be linked to. */
export function parseClipUrl(raw: string | null | undefined): ClipEmbed | null {
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return youtube(url) ?? twitch(url) ?? streamable(url)
}
