export function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function sanitizeFilename(name: string): string {
  const ascii = name.replace(/[-￿]/g, '')
  return ascii
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 80)
}

export function isImageFile(file: File) {
  return typeof file.type === 'string' && file.type.startsWith('image/')
}
