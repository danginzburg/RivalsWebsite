import { page } from 'vitest/browser'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-svelte'

import AdminDashboardShellTestHost from './AdminDashboardShellTestHost.svelte'

describe('AdminDashboardShell', () => {
  it('renders dashboard chrome, counts, status messages, and slot content', async () => {
    render(AdminDashboardShellTestHost)

    await expect.element(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument()
    await expect.element(page.getByText('Users (3)')).toBeInTheDocument()
    await expect.element(page.getByText('Teams (2)')).toBeInTheDocument()
    await expect.element(page.getByText('Something went wrong')).toBeInTheDocument()
    await expect.element(page.getByText('Saved successfully')).toBeInTheDocument()
    await expect.element(page.getByText('Admin body content')).toBeInTheDocument()
  })
})
