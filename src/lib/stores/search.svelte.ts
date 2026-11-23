import { MAX_COMPARE, type CompareKind } from '$lib/compare'

/**
 * Site-wide search state. The palette lives once, in the header; anything
 * else (the compare page's "Add" button) opens it through here.
 */
let open = $state(false)

export const searchPalette = {
  get open() {
    return open
  },
  set open(value: boolean) {
    open = value
  },
}

export type TrayItem = {
  id: string
  name: string
  subtitle: string | null
  imageUrl: string | null
}

const STORAGE_KEY = 'compare-tray'

let kind = $state<CompareKind | null>(null)
let items = $state<TrayItem[]>([])

/** Persist the given tray. Takes the values rather than reading the state, so calling it from an effect tracks nothing. */
function save(nextKind: CompareKind | null, nextItems: TrayItem[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: nextKind, items: nextItems }))
  } catch {
    // Storage blocked; the tray still works for this page view.
  }
}

/**
 * Players or teams picked from search to compare. One kind at a time, at most
 * MAX_COMPARE, kept for the browser tab so a visitor can add one, browse, and
 * add another.
 */
export const compareTray = {
  get kind() {
    return kind
  },
  get items() {
    return items
  },
  get full() {
    return items.length >= MAX_COMPARE
  },
  has(id: string) {
    return items.some((item) => item.id === id)
  },
  /** Whether an item of this kind could be added now. */
  accepts(itemKind: CompareKind) {
    return (kind === null || kind === itemKind) && items.length < MAX_COMPARE
  },
  toggle(itemKind: CompareKind, item: TrayItem) {
    if (this.has(item.id)) {
      this.remove(item.id)
      return
    }
    if (!this.accepts(itemKind)) return
    kind = itemKind
    items = [...items, item]
    save(kind, items)
  },
  remove(id: string) {
    items = items.filter((item) => item.id !== id)
    if (items.length === 0) kind = null
    save(kind, items)
  },
  /** Replace the tray, e.g. with what the compare page currently shows. */
  set(itemKind: CompareKind, next: TrayItem[]) {
    const nextKind = next.length ? itemKind : null
    const nextItems = next.slice(0, MAX_COMPARE)
    kind = nextKind
    items = nextItems
    save(nextKind, nextItems)
  },
  clear() {
    kind = null
    items = []
    save(null, [])
  },
  /** Restore the saved tray. Browser only, after hydration. */
  load() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as {
        kind: CompareKind | null
        items: TrayItem[]
      } | null
      if (saved && Array.isArray(saved.items)) {
        kind = saved.items.length ? saved.kind : null
        items = saved.items.slice(0, MAX_COMPARE)
      }
    } catch {
      // Nothing saved, or storage blocked.
    }
  },
}
