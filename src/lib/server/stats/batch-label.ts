export type BatchLabelInput = {
  id?: string
  display_name?: string | null
  import_kind?: string | null
}

export function toBatchLabel(b: BatchLabelInput): string {
  return (b.display_name ?? b.id ?? '').toString()
}
