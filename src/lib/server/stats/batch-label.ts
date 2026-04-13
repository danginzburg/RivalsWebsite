export type BatchLabelInput = {
  id?: string
  display_name?: string | null
  import_kind?: string | null
  week_label?: string | null
}

export function toBatchLabel(b: BatchLabelInput): string {
  const base = (b.display_name ?? b.id ?? '').toString()
  if (b.import_kind === 'weekly' && b.week_label) return `${base} (${b.week_label})`
  return base
}
