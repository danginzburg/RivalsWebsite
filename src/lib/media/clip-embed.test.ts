import { describe, expect, it } from 'vitest'

import { parseClipUrl } from './clip-embed'

const src = (url: string) => parseClipUrl(url)?.embedUrl('rivals.test') ?? null

describe('parseClipUrl', () => {
  it('embeds YouTube watch, short and youtu.be links, keeping the start time', () => {
    expect(src('https://www.youtube.com/watch?v=Y24VfQ8kKiM')).toContain(
      'youtube-nocookie.com/embed/Y24VfQ8kKiM'
    )
    expect(src('https://youtu.be/Y24VfQ8kKiM?t=1m30s')).toContain('start=90')
    expect(src('https://www.youtube.com/watch?v=Y24VfQ8kKiM&t=754')).toContain('start=754')
    const short = parseClipUrl('https://youtube.com/shorts/abcDEF12345')
    expect(short?.isVertical).toBe(true)
    expect(short?.thumbnailUrl).toBe('https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg')
  })

  it('embeds Twitch clips and VODs with the embedding site as parent', () => {
    expect(src('https://clips.twitch.tv/FunnySlug-abc')).toBe(
      'https://clips.twitch.tv/embed?clip=FunnySlug-abc&parent=rivals.test&autoplay=true'
    )
    expect(src('https://www.twitch.tv/someone/clip/FunnySlug-abc')).toContain('clip=FunnySlug-abc')
    expect(src('https://www.twitch.tv/videos/123456789?t=1h2m3s')).toBe(
      'https://player.twitch.tv/?video=v123456789&parent=rivals.test&autoplay=true&time=1h2m3s'
    )
  })

  it('embeds Streamable links', () => {
    expect(src('https://streamable.com/abc123')).toBe('https://streamable.com/e/abc123?autoplay=1')
  })

  it('leaves everything else as a plain link', () => {
    expect(parseClipUrl('https://medal.tv/games/valorant/clips/abc/xyz')).toBeNull()
    expect(parseClipUrl('https://www.twitch.tv/someone')).toBeNull()
    expect(parseClipUrl('not a url')).toBeNull()
    expect(parseClipUrl('javascript:alert(1)')).toBeNull()
    expect(parseClipUrl(null)).toBeNull()
  })
})
