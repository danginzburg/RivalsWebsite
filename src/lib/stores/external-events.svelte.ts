/**
 * Whether external events (Shitter League and any other `kind = 'external'`
 * season) show on the site's list pages. Hidden by default.
 *
 * One preference for the whole site, kept in this browser only. The pages are
 * CDN-cached, so the server always sends everything and each page filters on
 * the client; the server render matches the default (hidden).
 */
const STORAGE_KEY = 'show-external-events'

let show = $state(false)

export const externalEvents = {
  get show() {
    return show
  },
  set show(value: boolean) {
    show = value
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
      // Storage blocked; the choice still holds for this visit.
    }
  },
  toggle() {
    this.show = !show
  },
  /** Read the saved choice. Browser only, after hydration (root layout mount). */
  load() {
    try {
      show = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      // Storage blocked; keep the default.
    }
  },
}
