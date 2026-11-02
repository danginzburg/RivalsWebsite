import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'

import AdminSignupsTab from './AdminSignupsTab.svelte'
import type { PlayerSignup } from '$lib/admin/types'

function signup(id: string, values: Partial<PlayerSignup>) {
  return {
    id,
    profile_id: id,
    display_name: id,
    status: 'approved',
    created_at: '2026-10-01T00:00:00Z',
    computed_value: null,
    manual_value_override: null,
    manual_adjustment: 0,
    profile: { id, name: id, email: null, discord_username: null },
    ...values,
  } as PlayerSignup
}

const noop = () => {}

describe('AdminSignupsTab', () => {
  it('sorts by final score on request, with unscored signups last', async () => {
    const { container } = render(AdminSignupsTab, {
      signups: [
        signup('unscored', {}),
        signup('low', { computed_value: 10 }),
        signup('adjusted', { computed_value: 10, manual_adjustment: 5 }),
        signup('override', { computed_value: 1, manual_value_override: 20 }),
      ],
      signupsLoaded: true,
      statusFilter: 'approved',
      editForm: {},
      processingSignupId: null,
      onStatusFilterChange: noop,
      onEditChange: noop,
      onFetchRiotRank: noop,
      onBulkImport: noop,
      onStopBulkImport: noop,
      onDismissBulkReport: noop,
      onSave: noop,
      onSetStatus: noop,
      onDelete: noop,
      onSetAdjustment: noop,
    })

    const names = () =>
      [...container.querySelectorAll('article .truncate')].map((el) => el.textContent?.trim())

    expect(names()).toEqual(['unscored', 'low', 'adjusted', 'override'])

    await page.getByRole('button', { name: 'Newest first' }).click()
    await page.getByRole('option', { name: 'Highest score' }).click()

    await expect.poll(names).toEqual(['override', 'adjusted', 'low', 'unscored'])
  })
})
