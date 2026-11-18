import { adminFormRequest, adminJsonRequest } from '$lib/admin/api'
import { shrinkLogo } from '$lib/images/shrink-logo'
import type { AdminMessages } from '$lib/admin/signups.svelte'

/* State and actions for the admin Accolades tab. */

export type Accolade = {
  id: string
  name: string
  logo_path: string | null
  logo_url: string | null
  icon_key: string | null
  assignments: Array<{
    id: string
    profile_id: string
    display_name: string
    context?: string | null
    source?: 'manual' | 'auto'
  }>
}

export class AccoladesAdmin {
  private ui: AdminMessages

  constructor(ui: AdminMessages) {
    this.ui = ui
  }

  accolades = $state<Accolade[]>([])
  isSyncingSeasonAccolades = $state(false)
  accoladesLoaded = $state(false)
  createAccoladeName = $state('')
  createAccoladeIconKey = $state('')
  createAccoladeLogoFile = $state<File | null>(null)
  isCreatingAccolade = $state(false)
  accoladeAssignProfileId = $state<Record<string, string>>({})
  accoladeAssignContext = $state<Record<string, string>>({})
  editingAccoladeId = $state<string | null>(null)
  editAccoladeName = $state('')
  accoladeLogoStatus = $state<Record<string, 'uploading' | 'done' | null>>({})

  loadAccolades = async () => {
    try {
      const result = await adminJsonRequest<{ accolades?: Accolade[] }>('/api/admin/accolades', {
        fallbackMessage: 'Failed to load accolades',
      })
      this.accolades = result.accolades ?? []
      this.accoladesLoaded = true
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to load accolades'
    }
  }

  createAccolade = async () => {
    if (!this.createAccoladeName.trim() || this.isCreatingAccolade) return
    this.isCreatingAccolade = true
    this.ui.error = null
    try {
      const form = new FormData()
      form.set('name', this.createAccoladeName.trim())
      if (this.createAccoladeIconKey) form.set('icon_key', this.createAccoladeIconKey)
      if (this.createAccoladeLogoFile)
        form.set('logo', await shrinkLogo(this.createAccoladeLogoFile))
      const result = await adminFormRequest<{ accolade?: Accolade }>('/api/admin/accolades', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to create accolade',
      })
      if (result.accolade) this.accolades = [result.accolade, ...this.accolades]
      this.createAccoladeName = ''
      this.createAccoladeIconKey = ''
      this.createAccoladeLogoFile = null
      this.ui.success = 'Accolade created.'
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to create accolade'
    } finally {
      this.isCreatingAccolade = false
    }
  }

  renameAccolade = async (accoladeId: string) => {
    if (!this.editAccoladeName.trim()) return
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'rename', name: this.editAccoladeName.trim() },
        fallbackMessage: 'Failed to rename accolade',
      })
      this.accolades = this.accolades.map((a) =>
        a.id === accoladeId ? { ...a, name: this.editAccoladeName.trim() } : a
      )
      this.editingAccoladeId = null
      this.editAccoladeName = ''
      this.ui.success = 'Accolade renamed.'
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to rename accolade'
    }
  }

  deleteAccolade = async (accoladeId: string) => {
    if (!window.confirm('Delete this accolade? This removes it from all players.')) return
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'DELETE',
        body: { accoladeId },
        fallbackMessage: 'Failed to delete accolade',
      })
      this.accolades = this.accolades.filter((a) => a.id !== accoladeId)
      this.ui.success = 'Accolade deleted.'
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to delete accolade'
    }
  }

  updateAccoladeLogo = async (accoladeId: string, file: File) => {
    this.accoladeLogoStatus = { ...this.accoladeLogoStatus, [accoladeId]: 'uploading' }
    try {
      const form = new FormData()
      form.set('accoladeId', accoladeId)
      form.set('logo', await shrinkLogo(file))
      const result = await adminFormRequest<{ logo_url?: string }>('/api/admin/accolades', {
        method: 'PUT',
        body: form,
        fallbackMessage: 'Failed to upload logo',
      })
      this.accolades = this.accolades.map((a) =>
        a.id === accoladeId ? { ...a, logo_url: result.logo_url ?? a.logo_url } : a
      )
      this.accoladeLogoStatus = { ...this.accoladeLogoStatus, [accoladeId]: 'done' }
      window.setTimeout(() => {
        this.accoladeLogoStatus = { ...this.accoladeLogoStatus, [accoladeId]: null }
      }, 2000)
    } catch (err) {
      this.accoladeLogoStatus = { ...this.accoladeLogoStatus, [accoladeId]: null }
      this.ui.error = err instanceof Error ? err.message : 'Failed to upload logo'
    }
  }

  setAccoladeIconKey = async (accoladeId: string, iconKey: string) => {
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'set_icon_key', icon_key: iconKey },
        fallbackMessage: 'Failed to update accolade icon',
      })
      this.accolades = this.accolades.map((a) =>
        a.id === accoladeId ? { ...a, icon_key: iconKey || null } : a
      )
      this.ui.success = 'Accolade icon updated.'
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to update accolade icon'
    }
  }

  assignAccolade = async (accoladeId: string) => {
    const playerName = (this.accoladeAssignProfileId[accoladeId] ?? '').trim()
    const context = (this.accoladeAssignContext[accoladeId] ?? '').trim() || null
    if (!playerName) return
    try {
      const result = await adminJsonRequest<{
        assignment?: Omit<Accolade['assignments'][number], 'id'>
      }>('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'assign', playerName, context },
        fallbackMessage: 'Failed to assign accolade',
      })
      const assignment = result.assignment
      if (assignment) {
        this.accoladeAssignProfileId = { ...this.accoladeAssignProfileId, [accoladeId]: '' }
        this.accoladeAssignContext = { ...this.accoladeAssignContext, [accoladeId]: '' }
        this.accolades = this.accolades.map((a) =>
          a.id === accoladeId
            ? {
                ...a,
                assignments: [...a.assignments, { ...assignment, id: crypto.randomUUID() }],
              }
            : a
        )
      }
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to assign accolade'
    }
  }

  unassignAccolade = async (accoladeId: string, assignmentId: string) => {
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'unassign', assignmentId },
        fallbackMessage: 'Failed to unassign accolade',
      })
      this.accolades = this.accolades.map((a) =>
        a.id === accoladeId
          ? { ...a, assignments: a.assignments.filter((x) => x.id !== assignmentId) }
          : a
      )
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to unassign accolade'
    }
  }

  syncSeasonAccolades = async () => {
    if (this.isSyncingSeasonAccolades) return
    this.isSyncingSeasonAccolades = true
    try {
      const result = await adminJsonRequest<{
        added?: number
        removed?: number
        unmatched?: Record<string, string[]>
      }>('/api/admin/accolades', {
        method: 'PATCH',
        body: { action: 'sync_seasons' },
        fallbackMessage: 'Failed to sync season accolades',
      })
      const unmatchedCount = Object.values(result.unmatched ?? {}).reduce(
        (sum, names) => sum + names.length,
        0
      )
      this.ui.success =
        `Season accolades synced: ${result.added ?? 0} added, ${result.removed ?? 0} removed.` +
        (unmatchedCount > 0 ? ` ${unmatchedCount} roster names had no matching player.` : '')
      await this.loadAccolades()
    } catch (err) {
      this.ui.error = err instanceof Error ? err.message : 'Failed to sync season accolades'
    } finally {
      this.isSyncingSeasonAccolades = false
    }
  }
}
