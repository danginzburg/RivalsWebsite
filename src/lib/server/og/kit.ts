import satori from 'satori'
import sharp from 'sharp'
import { read } from '$app/server'
import boldFontUrl from './fonts/Nippo-Bold.ttf'
import regularFontUrl from './fonts/Nippo-Regular.ttf'

/**
 * Shared pieces of the 1200×630 link-preview cards (/og/*).
 *
 * satori lays out a small tree of plain objects into SVG with the text turned
 * into shapes, so the server needs no fonts installed; sharp turns that into a
 * PNG and also converts WebP logos and avatars, which satori cannot read.
 *
 * Two satori quirks every card has to respect:
 * - Padding is added *outside* an element's width/height (content-box), on
 *   every element: the root is sized `CARD_WIDTH − 2·PAD_X` by
 *   `CARD_HEIGHT − 2·PAD_Y` (see `cardRoot`), and a padded box with a fixed
 *   width takes its padding off that width.
 * - A row whose minimum content is wider than the space stretches the whole
 *   card instead of shrinking, so columns get fixed widths.
 */

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 630
export const PAD_X = 56
export const PAD_Y = 44
/** The width inside the padding. */
export const INNER_WIDTH = CARD_WIDTH - PAD_X * 2

export const COLORS = {
  text: '#ffffff',
  muted: 'rgba(236, 228, 248, 0.62)',
  faint: 'rgba(236, 228, 248, 0.35)',
  accent: '#c084fc',
  good: '#86efac',
  bad: '#fca5a5',
  gold: '#fcd34d',
  silver: '#d4d4d8',
  bronze: '#f0a868',
  panel: 'rgba(0, 0, 0, 0.28)',
  placeholder: '#512f8a',
  placeholderText: '#ece4f8',
}

export const BACKGROUND = 'linear-gradient(135deg, #1a1b25 0%, #2b1a4a 55%, #392061 100%)'

export type Node = { type: string; props: Record<string, unknown> }
type Child = Node | string | null | false | undefined

/** A satori element. Children may be nodes, strings, or falsy (skipped). */
export function h(type: string, style: Record<string, unknown>, ...children: Child[]): Node {
  const kids = children.filter((c): c is Node | string => !!c)
  return {
    type,
    props: { style: { display: 'flex', ...style }, children: kids.length === 1 ? kids[0] : kids },
  }
}

/** A square image; `style` adds to the defaults (e.g. a borderRadius for round avatars). */
export function img(src: string, size: number, style: Record<string, unknown> = {}): Node {
  return {
    type: 'img',
    props: {
      src,
      width: size,
      height: size,
      style: { width: size, height: size, objectFit: 'contain', ...style },
    },
  }
}

/** The coloured square (or circle) with initials shown when there is no image. */
export function placeholder(text: string, size: number, round = false): Node {
  return h(
    'div',
    {
      width: size,
      height: size,
      borderRadius: round ? size / 2 : Math.round(size * 0.14),
      backgroundColor: COLORS.placeholder,
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: Math.round(size * 0.32),
      fontWeight: 700,
      color: COLORS.placeholderText,
    },
    text
  )
}

/** Up to three letters standing in for a missing logo or avatar. */
export function initials(text: string): string {
  return text.slice(0, 3).toUpperCase()
}

/** An image, or the placeholder when it is missing. */
export function picture(src: string | null, fallback: string, size: number, round = false): Node {
  if (!src) return placeholder(initials(fallback), size, round)
  return img(src, size, round ? { borderRadius: size / 2, objectFit: 'cover' } : {})
}

let fontCache: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 700 }>> | null = null

function loadFonts() {
  fontCache ??= Promise.all([
    read(regularFontUrl).arrayBuffer(),
    read(boldFontUrl).arrayBuffer(),
  ]).then(([regular, bold]) => [
    { name: 'Nippo', data: regular, weight: 400 as const },
    { name: 'Nippo', data: bold, weight: 700 as const },
  ])
  return fontCache
}

/**
 * A remote image (team logo, avatar) as a PNG data URI satori can draw, or
 * null if it cannot be fetched or decoded. `cover` crops to fill the square
 * (avatars); otherwise it is fitted inside on transparency (logos).
 */
export async function logoDataUri(
  url: string | null | undefined,
  size: number,
  cover = false
): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return null
    return await toPngDataUri(await res.arrayBuffer(), size, cover)
  } catch {
    return null
  }
}

/** An image's bytes as a PNG data URI of `size`², or null if sharp cannot read it. */
async function toPngDataUri(
  bytes: ArrayBuffer,
  size: number,
  cover: boolean
): Promise<string | null> {
  try {
    const png = await sharp(Buffer.from(bytes))
      .resize(size, size, {
        fit: cover ? 'cover' : 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

/** The card's outer box: the background, padding and font, sized for satori. */
export function cardRoot(style: Record<string, unknown>, ...children: Child[]): Node {
  return h(
    'div',
    {
      // satori adds padding outside the root's size, so the size excludes it.
      width: CARD_WIDTH - PAD_X * 2,
      height: CARD_HEIGHT - PAD_Y * 2,
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: `${PAD_Y}px ${PAD_X}px`,
      fontFamily: 'Nippo',
      color: COLORS.text,
      backgroundImage: BACKGROUND,
      ...style,
    },
    ...children
  )
}

/** The name in each card's top-right corner (the site name without "TC"). */
export const CARD_BRAND = 'Rivals'

/** The top line most cards share: a small caps label on the left, the brand on the right. */
export function headerRow(label: string, brand: string = CARD_BRAND): Node {
  return h(
    'div',
    { justifyContent: 'space-between', alignItems: 'center' },
    h(
      'div',
      {
        fontSize: 28,
        fontWeight: 700,
        letterSpacing: 3,
        color: COLORS.muted,
        // Room for the brand; a long event name ends in an ellipsis.
        maxWidth: INNER_WIDTH - 180,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      },
      label.toUpperCase()
    ),
    h('div', { fontSize: 28, fontWeight: 700, color: COLORS.accent }, brand)
  )
}

/** The card as SVG (satori's output, before rasterising). */
export async function renderCardSvg(tree: Node): Promise<string> {
  return satori(tree as unknown as Parameters<typeof satori>[0], {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    fonts: await loadFonts(),
  })
}

/** The card as a PNG. */
export async function renderCard(tree: Node): Promise<Buffer> {
  return svgToPng(await renderCardSvg(tree))
}

export async function svgToPng(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * The response for a card endpoint: the PNG with the given cache header, or
 * in dev with `?svg`, satori's SVG for tweaking the design.
 */
export async function cardResponse(
  tree: Node,
  cacheControl: string,
  opts: { svg: boolean }
): Promise<Response> {
  const svg = await renderCardSvg(tree)
  if (opts.svg) return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } })
  const png = await svgToPng(svg)
  return new Response(new Uint8Array(png), {
    headers: { 'content-type': 'image/png', 'cache-control': cacheControl },
  })
}

/** Cache headers: a few hours on the CDN for live data, a day for things that are final. */
export const CACHE_HOURS = 'public, max-age=600, s-maxage=10800, stale-while-revalidate=86400'
export const CACHE_FINAL = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'
