/**
 * Logos are shown at 18-120px but admins upload originals of up to several
 * megabytes. Every byte served from Supabase Storage counts as cached egress,
 * so shrink them in the browser before upload: at most 256px on the long side
 * (2x the largest display size), re-encoded as WebP.
 */
export const LOGO_MAX_DIMENSION = 256

/** Pick the output size: scale the long side down to `max`, never up. */
export function fitWithin(width: number, height: number, max = LOGO_MAX_DIMENSION) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Swap the extension so the stored filename matches the new format. */
export function renameForType(name: string, type: string) {
  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'img'
  const base = name.replace(/\.[^.]+$/, '') || 'logo'
  return `${base}.${ext}`
}

/**
 * Return a smaller copy of `file`, or `file` itself when it can't be improved
 * (SVG and GIF are left alone; so is anything the browser can't decode).
 */
export async function shrinkLogo(file: File): Promise<File> {
  if (
    !file.type.startsWith('image/') ||
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif'
  ) {
    return file
  }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    // Browsers without WebP encoding hand back a PNG, which is still small at 256px.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.9)
    )
    if (!blob || blob.size >= file.size) return file
    return new File([blob], renameForType(file.name, blob.type), { type: blob.type })
  } finally {
    bitmap.close()
  }
}
