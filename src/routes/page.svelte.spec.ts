import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'
import Page from './+page.svelte'

// The matches feed reads its load data eagerly, so the props have to be real.
const emptyData = {
  matches: [],
  seeds: {},
  recentComments: [],
  loadFailed: false,
  unreachable: false,
  viewer: { isAdmin: false },
}

describe('/+page.svelte', () => {
  it('should render h1', async () => {
    render(Page, { data: emptyData } as never)

    const heading = page.getByRole('heading', { level: 1 })
    await expect.element(heading).toBeInTheDocument()
  })
})
