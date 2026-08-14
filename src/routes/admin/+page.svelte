<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { teamName, toDatetimeLocal } from '$lib/admin/match-ui'
  import { adminDashboardFetchAdapter, adminFormRequest, adminJsonRequest } from '$lib/admin/api'
  import { createAdminDashboardState } from '$lib/admin/dashboard/state'
  import {
    buildApprovedTeamOptions,
    filterAdminMatches,
    normalizeSearchValue,
    profileLabel,
  } from '$lib/admin/ui'
  import type { normalizePlayoffPickemConfig } from '$lib/playoffPickems'
  import AdminDashboardShell from '$lib/components/admin/AdminDashboardShell.svelte'
  import AdminMatchesTab from '$lib/components/admin/AdminMatchesTab.svelte'
  import AdminSeasonsTab from '$lib/components/admin/AdminSeasonsTab.svelte'
  import AdminTeamsTab from '$lib/components/admin/AdminTeamsTab.svelte'
  import AdminUsersTab from '$lib/components/admin/AdminUsersTab.svelte'
  import AdminAccoladesTab from '$lib/components/admin/AdminAccoladesTab.svelte'
  import AdminHallOfFameTab from '$lib/components/admin/AdminHallOfFameTab.svelte'
  import AdminModerationTab from '$lib/components/admin/AdminModerationTab.svelte'
  import AdminSignupsTab from '$lib/components/admin/AdminSignupsTab.svelte'
  import AdminActionConfirmationModal from '$lib/components/admin/AdminActionConfirmationModal.svelte'
  import type {
    ApprovedTeamEntry,
    AdminMatch,
    AdminPageDataExtras,
    AdminSeason,
    AdminTabId,
    AdminUser,
    BestOfValue,
    CommentReport,
    HallOfFameEntry,
    HallOfFameFormState,
    MatchEditState,
    MatchStreamFormState,
    PendingActionConfirmation,
    PendingRoleChange,
    PlayerSignup,
    SeasonEditState,
    SignupEditState,
    TeamEditState,
  } from '$lib/admin/types'
  import type { PageData, PageProps } from './$types'

  let { data: pageData }: PageProps = $props()

  /** Server load plus optional fields referenced before client fetch populates them. */
  type AdminPageData = PageData & AdminPageDataExtras

  const data = $derived(pageData as AdminPageData)
  const dashboardState = createAdminDashboardState({ fetchAdapter: adminDashboardFetchAdapter })

  let activeTab = $state<AdminTabId>('matches')
  let isLoading = $state(false)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const getInitialUsers = () => data.users || []
  const getInitialSeasons = () => data.seasons || []
  const getInitialApprovedTeams = () => data.approvedTeams || []
  const getInitialMatches = () => data.matches || []
  const getInitialSeasonId = () => data.activeSeasonId ?? ''

  let users = $state<AdminUser[]>(getInitialUsers())
  let seasons = $state<AdminSeason[]>(getInitialSeasons())
  let approvedTeams = $state<ApprovedTeamEntry[]>(getInitialApprovedTeams() as ApprovedTeamEntry[])
  let matches = $state<AdminMatch[]>(getInitialMatches())
  let adminMatchSeasonId = $state<string>(getInitialSeasonId())
  let matchSearchQuery = $state('')
  let showCompletedAdminMatches = $state(false)
  let createSeasonCode = $state('')
  let createSeasonName = $state('')
  let createSeasonStartsOn = $state('')
  let createSeasonEndsOn = $state('')
  let createSeasonIsActive = $state(false)
  let isCreatingSeason = $state(false)
  let seasonEditForm = $state<Record<string, SeasonEditState>>({})

  const approvedTeamOptions = $derived(buildApprovedTeamOptions(approvedTeams ?? []))

  const matchSeasonOptions = $derived.by(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: '', label: 'All seasons' }]
    for (const s of seasons) {
      opts.push({
        value: s.id,
        label: `${s.name}${s.is_active ? ' (Active)' : ''}`,
      })
    }
    opts.push({ value: '__none__', label: 'No season' })
    return opts
  })

  let createMatchTeamAId = $state('')
  let createMatchTeamBId = $state('')
  let createMatchBestOf = $state<BestOfValue>('3')
  let createMatchScheduledAt = $state('')
  let isCreatingMatch = $state(false)
  let expandedAdminMatchId = $state<string | null>(null)
  let matchMapsCache = $state<
    Record<
      string,
      Array<{ id: string; map_order: number; map_name: string | null; is_voided: boolean }>
    >
  >({})
  let matchMapsLoading = $state<Record<string, boolean>>({})

  type Accolade = {
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
    }>
  }
  let accolades = $state<Accolade[]>([])
  let accoladesLoaded = $state(false)
  let createAccoladeName = $state('')
  let createAccoladeIconKey = $state('')
  let createAccoladeLogoFile = $state<File | null>(null)
  let isCreatingAccolade = $state(false)
  let accoladeAssignProfileId = $state<Record<string, string>>({})
  let accoladeAssignContext = $state<Record<string, string>>({})
  let editingAccoladeId = $state<string | null>(null)
  let editAccoladeName = $state('')
  let accoladeLogoStatus = $state<Record<string, 'uploading' | 'done' | null>>({})

  // ---- Hall of Fame ----
  const blankHallOfFameForm = (): HallOfFameFormState => ({
    entryType: 'record',
    title: '',
    description: '',
    statValue: '',
    statLabel: '',
    mediaUrl: '',
    playerName: '',
    profileId: '',
    teamId: '',
    seasonId: '',
    isPublished: true,
    sortOrder: '0',
  })

  let hallOfFameEntries = $state<HallOfFameEntry[]>([])
  let hallOfFameLoaded = $state(false)
  let hallOfFameCreateForm = $state<HallOfFameFormState>(blankHallOfFameForm())
  let hallOfFameEditForm = $state<Record<string, HallOfFameFormState>>({})
  let isCreatingHallOfFameEntry = $state(false)
  let processingHallOfFameId = $state<string | null>(null)

  /** Options shared by the create and edit forms. Blank entry clears the field. */
  const hofTeamOptions = $derived([
    { value: '', label: '— None —' },
    ...(approvedTeams ?? []).map((t) => ({
      value: t.id,
      label: t.name + (t.tag ? ` (${t.tag})` : ''),
    })),
  ])

  const hofPlayerOptions = $derived([
    { value: '', label: '— None —' },
    ...(users ?? []).map((u) => ({
      value: u.id,
      label: u.riot_id_base ?? u.display_name ?? u.email ?? 'Player',
    })),
  ])

  const hofSeasonOptions = $derived([
    { value: '', label: '— None —' },
    ...(seasons ?? []).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
  ])

  async function loadHallOfFame() {
    try {
      const result = await adminJsonRequest<{ entries?: HallOfFameEntry[] }>(
        '/api/admin/hall-of-fame',
        { fallbackMessage: 'Failed to load hall of fame entries' }
      )
      hallOfFameEntries = result.entries ?? []
      hallOfFameLoaded = true
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load hall of fame entries'
    }
  }

  /** Map a form state onto the API request body. */
  function hallOfFameBody(state: HallOfFameFormState) {
    return {
      entryType: state.entryType,
      title: state.title,
      description: state.description || null,
      statValue: state.statValue || null,
      statLabel: state.statLabel || null,
      mediaUrl: state.mediaUrl || null,
      playerName: state.playerName || null,
      profileId: state.profileId || null,
      teamId: state.teamId || null,
      seasonId: state.seasonId || null,
      isPublished: state.isPublished,
      sortOrder: Number(state.sortOrder) || 0,
    }
  }

  async function createHallOfFameEntry() {
    if (!hallOfFameCreateForm.title.trim()) {
      errorMessage = 'Title is required'
      return
    }

    isCreatingHallOfFameEntry = true
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/hall-of-fame', {
        method: 'POST',
        body: hallOfFameBody(hallOfFameCreateForm),
        fallbackMessage: 'Failed to create entry',
      })
      successMessage = 'Entry added.'
      hallOfFameCreateForm = blankHallOfFameForm()
      await loadHallOfFame()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create entry'
    } finally {
      isCreatingHallOfFameEntry = false
    }
  }

  async function saveHallOfFameEntry(entryId: string) {
    const state = hallOfFameEditForm[entryId]
    if (!state) return

    processingHallOfFameId = entryId
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/hall-of-fame', {
        method: 'PATCH',
        body: { id: entryId, ...hallOfFameBody(state) },
        fallbackMessage: 'Failed to update entry',
      })
      successMessage = 'Entry updated.'
      await loadHallOfFame()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update entry'
    } finally {
      processingHallOfFameId = null
    }
  }

  async function deleteHallOfFameEntry(entryId: string, title: string) {
    if (!window.confirm(`Delete "${title}" from the Hall of Fame?`)) return

    processingHallOfFameId = entryId
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/hall-of-fame?id=${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
        fallbackMessage: 'Failed to delete entry',
      })
      successMessage = 'Entry deleted.'
      await loadHallOfFame()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to delete entry'
    } finally {
      processingHallOfFameId = null
    }
  }

  // ---- Player signups ----
  let playerSignups = $state<PlayerSignup[]>([])
  let signupsLoaded = $state(false)
  let signupStatusFilter = $state('pending')
  let signupEditForm = $state<Record<string, SignupEditState>>({})
  let processingSignupId = $state<string | null>(null)

  const pendingSignupCount = $derived(playerSignups.filter((s) => s.status === 'pending').length)

  async function loadSignups() {
    try {
      const result = await adminJsonRequest<{ signups?: PlayerSignup[] }>(
        `/api/admin/signups?status=${encodeURIComponent(signupStatusFilter)}`,
        { fallbackMessage: 'Failed to load signups' }
      )
      playerSignups = result.signups ?? []
      signupsLoaded = true
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load signups'
    }
  }

  function signupStateFor(signupId: string): SignupEditState | null {
    const existing = signupEditForm[signupId]
    if (existing) return existing

    const signup = playerSignups.find((s) => s.id === signupId)
    if (!signup) return null

    return {
      displayName: signup.display_name ?? '',
      discordHandle: signup.discord_handle ?? '',
      currentRank: signup.current_rank ?? '',
      peakRank: signup.peak_rank ?? '',
      trackerCurrentScore:
        signup.tracker_current_score != null ? String(signup.tracker_current_score) : '',
      trackerPeakScore: signup.tracker_peak_score != null ? String(signup.tracker_peak_score) : '',
      manualValueOverride:
        signup.manual_value_override != null ? String(signup.manual_value_override) : '',
      adminNotes: signup.admin_notes ?? '',
    }
  }

  function updateSignupEditForm(signupId: string, patch: Partial<SignupEditState>) {
    const current = signupStateFor(signupId)
    if (!current) return
    signupEditForm = { ...signupEditForm, [signupId]: { ...current, ...patch } }
  }

  /** Blank numeric fields are sent as null so the API clears them. */
  function signupBody(state: SignupEditState) {
    return {
      displayName: state.displayName || null,
      discordHandle: state.discordHandle || null,
      currentRank: state.currentRank || null,
      peakRank: state.peakRank || null,
      trackerCurrentScore: state.trackerCurrentScore === '' ? null : state.trackerCurrentScore,
      trackerPeakScore: state.trackerPeakScore === '' ? null : state.trackerPeakScore,
      manualValueOverride: state.manualValueOverride === '' ? null : state.manualValueOverride,
      adminNotes: state.adminNotes || null,
    }
  }

  let riotLookupSignupId = $state<string | null>(null)

  /**
   * Look the player up against the Riot API and fill the rank fields.
   * Only touches ranks — tracker scores are not exposed by that API, and any
   * manual override the admin has set is left alone.
   */
  async function fetchRiotRank(signupId: string) {
    const signup = playerSignups.find((s) => s.id === signupId)
    if (!signup) return

    const name = signup.display_name?.trim()
    const tag = signup.riot_tag?.trim()
    if (!name || !tag) {
      errorMessage = 'This signup has no Riot tagline, so it cannot be looked up.'
      return
    }

    riotLookupSignupId = signupId
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{
        account: { name: string; tag: string; region: string | null }
        rank: {
          currentTier: string | null
          currentRank: string | null
          peakTier: string | null
          peakRank: string | null
        } | null
      }>(`/api/admin/riot-lookup?riotId=${encodeURIComponent(`${name}#${tag}`)}`, {
        fallbackMessage: 'Riot lookup failed',
      })

      if (!result.rank) {
        successMessage = `${result.account.name}#${result.account.tag} verified, but has no competitive rank on record.`
        return
      }

      const patch: Partial<SignupEditState> = {}
      if (result.rank.currentRank) patch.currentRank = result.rank.currentRank
      if (result.rank.peakRank) patch.peakRank = result.rank.peakRank

      if (Object.keys(patch).length === 0) {
        successMessage = `${result.account.name}#${result.account.tag} verified, but their tier (${result.rank.currentTier ?? 'unknown'}) does not map to a league rank.`
        return
      }

      updateSignupEditForm(signupId, patch)
      successMessage = `Filled from Riot: ${result.rank.currentRank ?? '—'} current, ${result.rank.peakRank ?? '—'} peak. Save to apply.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Riot lookup failed'
    } finally {
      riotLookupSignupId = null
    }
  }

  let trackerLookupSignupId = $state<string | null>(null)

  /**
   * Read the player's tracker.gg score and fill Tc/Tp.
   * Leaves ranks and any manual override untouched.
   */
  async function fetchTrackerScore(signupId: string) {
    const signup = playerSignups.find((s) => s.id === signupId)
    if (!signup) return

    const name = signup.display_name?.trim()
    const tag = signup.riot_tag?.trim()
    if (!name || !tag) {
      errorMessage = 'This signup has no Riot tagline, so it cannot be looked up.'
      return
    }

    trackerLookupSignupId = signupId
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{
        current: { act: string; score: number } | null
        peak: { act: string; score: number } | null
        peakSource: 'peak-rank-act' | 'highest-score' | null
        peakRank: string | null
        warning: string | null
      }>(`/api/admin/tracker-lookup?riotId=${encodeURIComponent(`${name}#${tag}`)}`, {
        fallbackMessage: 'Tracker lookup failed',
      })

      const patch: Partial<SignupEditState> = {}
      if (result.current) patch.trackerCurrentScore = String(result.current.score)
      if (result.peak) patch.trackerPeakScore = String(result.peak.score)

      if (Object.keys(patch).length === 0) {
        errorMessage = 'No tracker scores found for that profile.'
        return
      }

      updateSignupEditForm(signupId, patch)

      // Say where the peak came from — the act they peaked in, or a fallback.
      const peakNote =
        result.peakSource === 'peak-rank-act'
          ? `Tp ${result.peak?.score} from ${result.peak?.act}, the act they peaked at ${result.peakRank ?? 'their best rank'}`
          : `Tp ${result.peak?.score ?? '—'} (${result.peak?.act ?? '—'}, highest recent act)`

      successMessage =
        `Filled from tracker.gg: Tc ${result.current?.score ?? '—'} (${result.current?.act}), ${peakNote}. Save to apply.` +
        (result.warning ? ` ${result.warning}` : '')
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Tracker lookup failed'
    } finally {
      trackerLookupSignupId = null
    }
  }

  type BulkImportReport = {
    processed: number
    updated: number
    skipped: number
    failed: number
    stoppedEarly: boolean
    remaining: number
    rows: Array<{ id: string; name: string; outcome: string; detail: string }>
  }

  let bulkImportRunning = $state(false)
  let bulkImportReport = $state<BulkImportReport | null>(null)

  /**
   * Fill ranks and tracker scores for the whole filtered list in one pass.
   * The server paces the third-party requests and works to a time budget, so a
   * run that stops early is continued by simply pressing the button again.
   */
  async function runSignupBulkImport(source: 'riot' | 'tracker' | 'both', overwrite: boolean) {
    const what =
      source === 'riot'
        ? 'ranks from Riot'
        : source === 'tracker'
          ? 'tracker.gg scores'
          : 'ranks and tracker.gg scores'
    const scope = signupStatusFilter === 'all' ? '' : `${signupStatusFilter} `
    const warning = overwrite ? '\n\nExisting values will be replaced.' : ''
    if (!window.confirm(`Fetch ${what} for the ${scope}signups?${warning}`)) return

    bulkImportRunning = true
    bulkImportReport = null
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{ report: BulkImportReport }>(
        '/api/admin/signups/bulk-import',
        {
          method: 'POST',
          body: { source, overwrite, status: signupStatusFilter },
          fallbackMessage: 'Bulk import failed',
        }
      )

      const report = result.report
      bulkImportReport = report
      successMessage =
        `Bulk import: ${report.updated} updated, ${report.skipped} skipped, ${report.failed} failed.` +
        (report.stoppedEarly
          ? ` Ran out of time with ${report.remaining} left — run it again to continue.`
          : '')
      await loadSignups()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Bulk import failed'
    } finally {
      bulkImportRunning = false
    }
  }

  async function saveSignup(signupId: string, status?: 'pending' | 'approved' | 'rejected') {
    const state = signupStateFor(signupId)
    if (!state) return

    processingSignupId = signupId
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/signups', {
        method: 'PATCH',
        body: { id: signupId, ...signupBody(state), ...(status ? { status } : {}) },
        fallbackMessage: 'Failed to update signup',
      })
      successMessage = status ? `Signup ${status}.` : 'Signup updated.'
      await loadSignups()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update signup'
    } finally {
      processingSignupId = null
    }
  }

  async function deleteSignup(signupId: string, name: string) {
    if (!window.confirm(`Delete the signup for ${name}?`)) return

    processingSignupId = signupId
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/signups?id=${encodeURIComponent(signupId)}`, {
        method: 'DELETE',
        fallbackMessage: 'Failed to delete signup',
      })
      successMessage = 'Signup deleted.'
      await loadSignups()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to delete signup'
    } finally {
      processingSignupId = null
    }
  }

  // ---- Comment moderation ----
  let commentReports = $state<CommentReport[]>([])
  let commentReportsLoaded = $state(false)
  let commentReportStatusFilter = $state('pending')
  let processingReportId = $state<string | null>(null)

  /** Pending count drives the badge on the Moderation tab. */
  const pendingReportCount = $derived(commentReports.filter((r) => r.status === 'pending').length)

  async function loadCommentReports() {
    try {
      const result = await adminJsonRequest<{ reports?: CommentReport[] }>(
        `/api/admin/comment-reports?status=${encodeURIComponent(commentReportStatusFilter)}`,
        { fallbackMessage: 'Failed to load reports' }
      )
      commentReports = result.reports ?? []
      commentReportsLoaded = true
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load reports'
    }
  }

  async function moderationAction(
    reportId: string | null,
    body: Record<string, unknown>,
    successText: string
  ) {
    processingReportId = reportId
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/comment-reports', {
        method: 'PATCH',
        body,
        fallbackMessage: 'Moderation action failed',
      })
      successMessage = successText
      await loadCommentReports()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Moderation action failed'
    } finally {
      processingReportId = null
    }
  }

  function resolveReport(reportId: string) {
    return moderationAction(reportId, { action: 'resolve', reportId }, 'Report resolved.')
  }

  function dismissReport(reportId: string) {
    return moderationAction(reportId, { action: 'dismiss', reportId }, 'Report dismissed.')
  }

  function deleteReportedComment(commentId: string, reportId: string) {
    if (!window.confirm('Delete this comment? Replies to it will remain.')) return
    return moderationAction(reportId, { action: 'delete_comment', commentId }, 'Comment deleted.')
  }

  function banFromCommenting(profileId: string, name: string) {
    const input = window.prompt(
      `Ban ${name} from commenting.\n\nEnter the number of days, or leave blank for a permanent ban.`,
      '7'
    )
    if (input === null) return

    const days = input.trim() === '' ? 0 : Number(input)
    if (input.trim() !== '' && (!Number.isFinite(days) || days < 0)) {
      errorMessage = 'Enter a positive number of days, or leave it blank for permanent.'
      return
    }

    const reason = window.prompt('Reason shown to the user (optional):') ?? null
    return moderationAction(
      null,
      { action: 'ban', profileId, days, reason },
      days > 0 ? `${name} banned for ${days} day(s).` : `${name} banned permanently.`
    )
  }

  function unbanFromCommenting(profileId: string, name: string) {
    if (!window.confirm(`Lift the commenting ban on ${name}?`)) return
    return moderationAction(null, { action: 'unban', profileId }, `Ban lifted for ${name}.`)
  }

  function updateHallOfFameEditForm(entryId: string, patch: Partial<HallOfFameFormState>) {
    const entry = hallOfFameEntries.find((e) => e.id === entryId)
    const current =
      hallOfFameEditForm[entryId] ??
      (entry
        ? {
            entryType: entry.entry_type,
            title: entry.title,
            description: entry.description ?? '',
            statValue: entry.stat_value ?? '',
            statLabel: entry.stat_label ?? '',
            mediaUrl: entry.media_url ?? '',
            playerName: entry.player_name ?? '',
            profileId: entry.profile_id ?? '',
            teamId: entry.team_id ?? '',
            seasonId: entry.season_id ?? '',
            isPublished: entry.is_published,
            sortOrder: String(entry.sort_order ?? 0),
          }
        : blankHallOfFameForm())

    hallOfFameEditForm = {
      ...hallOfFameEditForm,
      [entryId]: { ...current, ...patch },
    }
  }

  const filteredAdminMatches = $derived(
    filterAdminMatches(matches ?? [], matchSearchQuery, showCompletedAdminMatches)
  )

  async function fetchMatchMaps(matchId: string) {
    if (matchMapsCache[matchId] || matchMapsLoading[matchId]) return
    matchMapsLoading = { ...matchMapsLoading, [matchId]: true }
    try {
      const result = await adminJsonRequest<{ maps?: (typeof matchMapsCache)[string] }>(
        `/api/admin/matches/${matchId}/maps`,
        { fallbackMessage: 'Failed to load match maps' }
      )
      matchMapsCache = { ...matchMapsCache, [matchId]: result.maps ?? [] }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load match maps'
    } finally {
      matchMapsLoading = { ...matchMapsLoading, [matchId]: false }
    }
  }

  async function toggleMapVoided(matchId: string, mapId: string, currentVoided: boolean) {
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}`, {
        method: 'PATCH',
        body: { action: 'toggle_map_voided', mapId, isVoided: !currentVoided },
        fallbackMessage: 'Failed to update map',
      })
      const maps = matchMapsCache[matchId] ?? []
      matchMapsCache = {
        ...matchMapsCache,
        [matchId]: maps.map((map) =>
          map.id === mapId ? { ...map, is_voided: !currentVoided } : map
        ),
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update map'
    }
  }

  async function loadAccolades() {
    try {
      const result = await adminJsonRequest<{ accolades?: Accolade[] }>('/api/admin/accolades', {
        fallbackMessage: 'Failed to load accolades',
      })
      accolades = result.accolades ?? []
      accoladesLoaded = true
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to load accolades'
    }
  }

  async function createAccolade() {
    if (!createAccoladeName.trim() || isCreatingAccolade) return
    isCreatingAccolade = true
    errorMessage = null
    try {
      const form = new FormData()
      form.set('name', createAccoladeName.trim())
      if (createAccoladeIconKey) form.set('icon_key', createAccoladeIconKey)
      if (createAccoladeLogoFile) form.set('logo', createAccoladeLogoFile)
      const result = await adminFormRequest<{ accolade?: Accolade }>('/api/admin/accolades', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to create accolade',
      })
      if (result.accolade) accolades = [result.accolade, ...accolades]
      createAccoladeName = ''
      createAccoladeIconKey = ''
      createAccoladeLogoFile = null
      successMessage = 'Accolade created.'
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create accolade'
    } finally {
      isCreatingAccolade = false
    }
  }

  async function renameAccolade(accoladeId: string) {
    if (!editAccoladeName.trim()) return
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'rename', name: editAccoladeName.trim() },
        fallbackMessage: 'Failed to rename accolade',
      })
      accolades = accolades.map((a) =>
        a.id === accoladeId ? { ...a, name: editAccoladeName.trim() } : a
      )
      editingAccoladeId = null
      editAccoladeName = ''
      successMessage = 'Accolade renamed.'
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to rename accolade'
    }
  }

  async function deleteAccolade(accoladeId: string) {
    if (!window.confirm('Delete this accolade? This removes it from all players.')) return
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'DELETE',
        body: { accoladeId },
        fallbackMessage: 'Failed to delete accolade',
      })
      accolades = accolades.filter((a) => a.id !== accoladeId)
      successMessage = 'Accolade deleted.'
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to delete accolade'
    }
  }

  async function updateAccoladeLogo(accoladeId: string, file: File) {
    accoladeLogoStatus = { ...accoladeLogoStatus, [accoladeId]: 'uploading' }
    try {
      const form = new FormData()
      form.set('accoladeId', accoladeId)
      form.set('logo', file)
      const result = await adminFormRequest<{ logo_url?: string }>('/api/admin/accolades', {
        method: 'PUT',
        body: form,
        fallbackMessage: 'Failed to upload logo',
      })
      accolades = accolades.map((a) =>
        a.id === accoladeId ? { ...a, logo_url: result.logo_url ?? a.logo_url } : a
      )
      accoladeLogoStatus = { ...accoladeLogoStatus, [accoladeId]: 'done' }
      window.setTimeout(() => {
        accoladeLogoStatus = { ...accoladeLogoStatus, [accoladeId]: null }
      }, 2000)
    } catch (err) {
      accoladeLogoStatus = { ...accoladeLogoStatus, [accoladeId]: null }
      errorMessage = err instanceof Error ? err.message : 'Failed to upload logo'
    }
  }

  async function setAccoladeIconKey(accoladeId: string, iconKey: string) {
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'set_icon_key', icon_key: iconKey },
        fallbackMessage: 'Failed to update accolade icon',
      })
      accolades = accolades.map((a) =>
        a.id === accoladeId ? { ...a, icon_key: iconKey || null } : a
      )
      successMessage = 'Accolade icon updated.'
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update accolade icon'
    }
  }

  async function assignAccolade(accoladeId: string) {
    const playerName = (accoladeAssignProfileId[accoladeId] ?? '').trim()
    const context = (accoladeAssignContext[accoladeId] ?? '').trim() || null
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
        accoladeAssignProfileId = { ...accoladeAssignProfileId, [accoladeId]: '' }
        accoladeAssignContext = { ...accoladeAssignContext, [accoladeId]: '' }
        accolades = accolades.map((a) =>
          a.id === accoladeId
            ? {
                ...a,
                assignments: [...a.assignments, { ...assignment, id: crypto.randomUUID() }],
              }
            : a
        )
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to assign accolade'
    }
  }

  async function unassignAccolade(accoladeId: string, assignmentId: string) {
    try {
      await adminJsonRequest('/api/admin/accolades', {
        method: 'PATCH',
        body: { accoladeId, action: 'unassign', assignmentId },
        fallbackMessage: 'Failed to unassign accolade',
      })
      accolades = accolades.map((a) =>
        a.id === accoladeId
          ? { ...a, assignments: a.assignments.filter((x) => x.id !== assignmentId) }
          : a
      )
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to unassign accolade'
    }
  }

  let createTeamName = $state('')
  let createTeamTag = $state('')
  let createTeamLogoFile = $state<File | null>(null)
  let isCreatingTeam = $state(false)

  let addPlayerForm = $state<Record<string, { playerName: string; role: string }>>({})
  let teamEditForm = $state<Record<string, TeamEditState>>({})
  let teamLogoFileById = $state<Record<string, File | null>>({})

  function updateAddPlayerForm(
    teamId: string,
    patch: Partial<{ playerName: string; role: string }>
  ) {
    const current = addPlayerForm[teamId] ?? { playerName: '', role: 'player' }
    addPlayerForm = {
      ...addPlayerForm,
      [teamId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    // Ensure per-team form state exists without mutating during render.
    const ids = new Set((approvedTeams ?? []).map((t) => t.id))
    const next: Record<string, { playerName: string; role: string }> = {}
    for (const id of ids) {
      next[id] = addPlayerForm[id] ?? { playerName: '', role: 'player' }
    }
    // Preserve object identity when no changes.
    const prevKeys = Object.keys(addPlayerForm)
    const nextKeys = Object.keys(next)
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some(
        (k) =>
          !addPlayerForm[k] ||
          addPlayerForm[k].playerName !== next[k].playerName ||
          addPlayerForm[k].role !== next[k].role
      )
    if (changed) addPlayerForm = next
  })

  function updateTeamEditForm(teamId: string, patch: Partial<TeamEditState>) {
    const current =
      teamEditForm[teamId] ??
      ({
        name: '',
        tag: '',
        status: 'active',
      } as const)
    teamEditForm = {
      ...teamEditForm,
      [teamId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    const next: Record<string, TeamEditState> = {}
    const nextLogos: Record<string, File | null> = {}
    for (const team of approvedTeams ?? []) {
      next[team.id] = teamEditForm[team.id] ?? {
        name: team.name ?? '',
        tag: team.tag ?? '',
        status: team.status ?? 'active',
      }
      nextLogos[team.id] = teamLogoFileById[team.id] ?? null
    }
    const teamKeys = Object.keys(next)
    const currentKeys = Object.keys(teamEditForm)
    const teamChanged =
      teamKeys.length !== currentKeys.length ||
      teamKeys.some(
        (key) => JSON.stringify(teamEditForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (teamChanged) teamEditForm = next

    const logoKeys = Object.keys(nextLogos)
    const currentLogoKeys = Object.keys(teamLogoFileById)
    const logoChanged =
      logoKeys.length !== currentLogoKeys.length ||
      logoKeys.some((key) => teamLogoFileById[key] !== nextLogos[key])
    if (logoChanged) teamLogoFileById = nextLogos
  })

  let createTeamLogoInput = $state<HTMLInputElement | null>(null)

  let finalizeForm = $state<
    Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }>
  >({})
  let matchEditForm = $state<Record<string, MatchEditState>>({})
  let streamForm = $state<Record<string, MatchStreamFormState>>({})
  let existingStreamForm = $state<Record<string, MatchStreamFormState>>({})
  let vodForm = $state<Record<string, string>>({})

  function updateFinalizeForm(
    matchId: string,
    patch: Partial<{ teamAScore: string; teamBScore: string; winnerTeamId: string }>
  ) {
    const current =
      finalizeForm[matchId] ?? ({ teamAScore: '0', teamBScore: '0', winnerTeamId: '' } as const)
    finalizeForm = {
      ...finalizeForm,
      [matchId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    const ids = new Set((matches ?? []).map((m) => m.id))
    const next: Record<string, { teamAScore: string; teamBScore: string; winnerTeamId: string }> =
      {}
    for (const m of matches ?? []) {
      const prev = finalizeForm[m.id]
      next[m.id] = prev ?? {
        teamAScore: String(m.team_a_score ?? 0),
        teamBScore: String(m.team_b_score ?? 0),
        winnerTeamId: m.winner_team_id ?? m.team_a_id,
      }
    }

    const prevKeys = Object.keys(finalizeForm)
    const nextKeys = Object.keys(next)
    const changed =
      prevKeys.length !== nextKeys.length ||
      nextKeys.some(
        (k) =>
          !finalizeForm[k] ||
          finalizeForm[k].teamAScore !== next[k].teamAScore ||
          finalizeForm[k].teamBScore !== next[k].teamBScore ||
          finalizeForm[k].winnerTeamId !== next[k].winnerTeamId
      ) ||
      prevKeys.some((k) => !ids.has(k))
    if (changed) finalizeForm = next
  })

  function updateMatchEditForm(matchId: string, patch: Partial<MatchEditState>) {
    const current =
      matchEditForm[matchId] ??
      ({
        teamAId: '',
        teamBId: '',
        bestOf: '3',
        status: 'scheduled',
        scheduledAt: '',
        teamAScore: '0',
        teamBScore: '0',
        winnerTeamId: '',
        mapVetoes: '',
        designation: '',
      } as const)
    matchEditForm = {
      ...matchEditForm,
      [matchId]: {
        ...current,
        ...patch,
      },
    }
  }

  $effect(() => {
    const next: Record<string, MatchEditState> = {}
    for (const match of matches ?? []) {
      next[match.id] = matchEditForm[match.id] ?? {
        teamAId: match.team_a_id,
        teamBId: match.team_b_id,
        bestOf: String(match.best_of ?? 3),
        status: match.status ?? 'scheduled',
        scheduledAt: toDatetimeLocal(match.scheduled_at),
        teamAScore: String(match.team_a_score ?? 0),
        teamBScore: String(match.team_b_score ?? 0),
        winnerTeamId: match.winner_team_id ?? '',
        mapVetoes: Array.isArray(match.metadata?.map_vetoes)
          ? match.metadata.map_vetoes.join('\n')
          : '',
        designation: (match.metadata?.designation as string | undefined) ?? '',
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(matchEditForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(matchEditForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) matchEditForm = next
  })

  $effect(() => {
    const next: Record<string, MatchStreamFormState> = {}
    for (const match of matches ?? []) {
      next[match.id] = streamForm[match.id] ?? {
        platform: 'twitch',
        streamUrl: '',
        displayName: '',
        status: match.status === 'live' ? 'live' : 'scheduled',
        isPrimary: !(match.streams?.length > 0),
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(streamForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some((key) => JSON.stringify(streamForm[key] ?? {}) !== JSON.stringify(next[key] ?? {}))
    if (changed) streamForm = next
  })

  $effect(() => {
    const next: Record<string, MatchStreamFormState> = {}
    for (const match of matches ?? []) {
      for (const stream of match.streams ?? []) {
        next[stream.id] = existingStreamForm[stream.id] ?? {
          platform: stream.platform ?? 'twitch',
          streamUrl: stream.stream_url ?? '',
          displayName:
            typeof stream.metadata?.display_name === 'string' ? stream.metadata.display_name : '',
          status: stream.status ?? 'scheduled',
          isPrimary: Boolean(stream.is_primary),
        }
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(existingStreamForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(existingStreamForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) existingStreamForm = next
  })

  $effect(() => {
    const next: Record<string, string> = {}
    for (const match of matches ?? []) {
      next[match.id] = vodForm[match.id] ?? match.vod_url ?? ''
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(vodForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some((key) => (vodForm[key] ?? '') !== (next[key] ?? ''))
    if (changed) vodForm = next
  })

  $effect(() => {
    const next: Record<string, SeasonEditState> = {}
    for (const season of seasons ?? []) {
      next[season.id] = seasonEditForm[season.id] ?? {
        code: season.code ?? '',
        name: season.name ?? '',
        startsOn: season.starts_on ?? '',
        endsOn: season.ends_on ?? '',
        isActive: Boolean(season.is_active),
        summary: season.summary ?? '',
        winnerTeamId: season.winner_team_id ?? '',
        runnerUpTeamId: season.runner_up_team_id ?? '',
        mvpProfileId: season.mvp_profile_id ?? '',
        finalLeaderboardBatchId: season.final_leaderboard_batch_id ?? '',
      }
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(seasonEditForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some(
        (key) => JSON.stringify(seasonEditForm[key] ?? {}) !== JSON.stringify(next[key] ?? {})
      )
    if (changed) seasonEditForm = next
  })

  // Role change confirmation
  let showRoleConfirmation = $state(false)
  let pendingRoleChange = $state<PendingRoleChange | null>(null)
  let isUpdatingRole = $state(false)
  let usersSearch = $state('')
  let userRiotIdForm = $state<Record<string, string>>({})
  let teamsSearch = $state('')
  let processingTeamId = $state<string | null>(null)
  let showActionConfirmation = $state(false)
  let pendingActionConfirmation = $state<PendingActionConfirmation | null>(null)

  const displayedUsers = $derived.by(() => {
    const search = normalizeSearchValue(usersSearch)
    return users.filter((user) => {
      if (!search) return true
      const haystack =
        `${user.display_name ?? ''} ${user.email ?? ''} ${user.role ?? ''}`.toLowerCase()
      return haystack.includes(search)
    })
  })

  $effect(() => {
    const next: Record<string, string> = {}
    for (const user of users ?? []) {
      next[user.id] = userRiotIdForm[user.id] ?? user.riot_id_base ?? ''
    }
    const keys = Object.keys(next)
    const currentKeys = Object.keys(userRiotIdForm)
    const changed =
      keys.length !== currentKeys.length ||
      keys.some((key) => (userRiotIdForm[key] ?? '') !== (next[key] ?? ''))
    if (changed) userRiotIdForm = next
  })

  const displayedApprovedTeams = $derived.by(() => {
    const search = normalizeSearchValue(teamsSearch)
    return approvedTeams.filter((team) => {
      if (!search) return true
      const captain = profileLabel(team.captain_profile)
      const haystack = `${team.name ?? ''} ${team.tag ?? ''} ${captain}`.toLowerCase()
      return haystack.includes(search)
    })
  })

  /**
   * Accolades, hall of fame, moderation and signups are not part of
   * `fetchDashboardData` — they were added after it and fetch themselves the
   * first time their tab is opened, guarded by a `*Loaded` flag. That guard
   * also meant nothing ever refetched them: Refresh skipped them, and
   * reopening the tab saw them as already loaded, so newly added rows never
   * appeared until a full page reload.
   *
   * Only tabs the admin has actually opened are refreshed, so the rest stay
   * lazy and Refresh does not fan out to every endpoint on the site.
   */
  async function refreshLazyTabs() {
    await Promise.all([
      accoladesLoaded ? loadAccolades() : Promise.resolve(),
      hallOfFameLoaded ? loadHallOfFame() : Promise.resolve(),
      commentReportsLoaded ? loadCommentReports() : Promise.resolve(),
      signupsLoaded ? loadSignups() : Promise.resolve(),
    ])
  }

  async function refreshData() {
    // Kicked off first so it overlaps the core fetch instead of queueing behind it.
    const lazyTabs = refreshLazyTabs()

    await dashboardState.refresh({
      seasonId: adminMatchSeasonId || undefined,
      setLoading: (value) => (isLoading = value),
      setError: (message) => (errorMessage = message),
      setSuccess: (message) => (successMessage = message),
      replaceData: (dashboardData) => {
        users = dashboardData.users as AdminUser[]
        seasons = dashboardData.seasons as AdminSeason[]
        approvedTeams = dashboardData.approved as ApprovedTeamEntry[]
        matches = dashboardData.matches
      },
    })

    // Hold the spinner until the lazy tabs land too — otherwise Refresh reports
    // itself done while the tab being looked at is still showing stale rows.
    isLoading = true
    await lazyTabs
    isLoading = false
  }

  async function onMatchSeasonChange(seasonId: string) {
    adminMatchSeasonId = seasonId
    await refreshData()
  }

  async function finalizeMatch(match: AdminMatch) {
    const state = finalizeForm[match.id] ?? {
      teamAScore: String(match.team_a_score ?? 0),
      teamBScore: String(match.team_b_score ?? 0),
      winnerTeamId: match.winner_team_id ?? match.team_a_id,
    }

    pendingActionConfirmation = dashboardState.buildFinalizeConfirmation(match, state)
    showActionConfirmation = true
  }

  async function executeFinalizeMatch(action: {
    matchId: string
    teamAScore: string
    teamBScore: string
    winnerTeamId: string
  }) {
    errorMessage = null
    successMessage = null

    try {
      const result = await dashboardState.finalizeMatch(action)
      successMessage = result.success ?? 'Match finalized.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to finalize match'
    }
  }

  async function cancelMatch(match: AdminMatch) {
    pendingActionConfirmation = dashboardState.buildCancelConfirmation(match)
    showActionConfirmation = true
  }

  async function executeCancelMatch(matchId: string) {
    errorMessage = null
    successMessage = null

    try {
      const result = await dashboardState.cancelMatch(matchId)
      successMessage = result.success ?? 'Match cancelled.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to cancel match'
    }
  }

  async function createMatch() {
    errorMessage = null
    successMessage = null

    if (!createMatchTeamAId || !createMatchTeamBId) {
      errorMessage = 'Select both teams'
      return
    }
    if (createMatchTeamAId === createMatchTeamBId) {
      errorMessage = 'Teams must be different'
      return
    }

    isCreatingMatch = true
    try {
      const result = await dashboardState.createMatch({
        teamAId: createMatchTeamAId,
        teamBId: createMatchTeamBId,
        bestOf: createMatchBestOf,
        scheduledAt: createMatchScheduledAt,
        // New rows land in whichever season is being viewed, so filtering to a
        // past season is how you backfill its history.
        seasonId: adminMatchSeasonId || undefined,
      })
      if (result.error) {
        errorMessage = result.error
        return
      }

      successMessage = result.success ?? 'Match created.'
      createMatchScheduledAt = ''
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create match'
    } finally {
      isCreatingMatch = false
    }
  }

  async function createTeam() {
    errorMessage = null
    successMessage = null

    if (!createTeamName.trim()) {
      errorMessage = 'Team name is required'
      return
    }

    isCreatingTeam = true
    try {
      const form = new FormData()
      form.set('name', createTeamName)
      form.set('tag', createTeamTag)
      if (createTeamLogoFile) form.set('logo', createTeamLogoFile)
      // Matches the season currently being viewed, so a past season can be
      // populated with the teams that played in it.
      if (adminMatchSeasonId) form.set('seasonId', adminMatchSeasonId)

      await adminFormRequest('/api/admin/teams', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to create team',
        includeHttpStatusInError: true,
      })

      successMessage = 'Team created.'
      createTeamName = ''
      createTeamTag = ''
      createTeamLogoFile = null
      if (createTeamLogoInput) createTeamLogoInput.value = ''
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create team'
    } finally {
      isCreatingTeam = false
    }
  }

  async function executeSaveTeamEdits(teamId: string) {
    const state = teamEditForm[teamId]
    if (!state) return

    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      const form = new FormData()
      form.set('name', state.name ?? '')
      form.set('tag', state.tag ?? '')
      form.set('status', state.status ?? 'active')
      if (teamLogoFileById[teamId]) form.set('logo', teamLogoFileById[teamId]!)

      await adminFormRequest(`/api/admin/teams/${teamId}`, {
        method: 'PATCH',
        body: form,
        fallbackMessage: 'Failed to update team',
      })

      successMessage = 'Team updated.'
      teamLogoFileById = { ...teamLogoFileById, [teamId]: null }
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update team'
    } finally {
      processingTeamId = null
    }
  }

  async function executeSaveMatchEdits(matchId: string) {
    const state = matchEditForm[matchId]
    if (!state) return

    errorMessage = null
    successMessage = null

    try {
      const result = await dashboardState.saveMatch(matchId, state, vodForm[matchId] || null)
      successMessage = result.success
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update match'
    }
  }

  function saveTeamEdits(teamId: string, teamName: string) {
    pendingActionConfirmation = {
      kind: 'save_team',
      teamId,
      title: 'Confirm Team Update',
      message: `Save edits for ${teamName}? This updates public team details and import aliases.`,
      confirmLabel: 'Save Team Changes',
    }
    showActionConfirmation = true
  }

  function saveMatchEdits(matchId: string, match: AdminMatch) {
    pendingActionConfirmation = {
      kind: 'save_match',
      matchId,
      title: 'Confirm Match Update',
      message: `Save edits for ${teamName(match.team_a)} vs ${teamName(match.team_b)}?`,
      confirmLabel: 'Save Match Changes',
    }
    showActionConfirmation = true
  }

  function deleteMatch(matchId: string, match: AdminMatch) {
    pendingActionConfirmation = {
      kind: 'delete_match',
      matchId,
      title: 'Confirm Match Deletion',
      message: `Delete ${teamName(match.team_a)} vs ${teamName(match.team_b)} permanently? This is only for cleanup mistakes and cannot be undone.`,
      confirmLabel: 'Delete Match',
    }
    showActionConfirmation = true
  }

  async function executeDeleteMatch(matchId: string) {
    errorMessage = null
    successMessage = null
    try {
      const result = await dashboardState.deleteMatch(matchId)
      successMessage = result.success
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to delete match'
    }
  }

  async function addMatchStream(matchId: string) {
    const state = streamForm[matchId]
    if (!state?.streamUrl?.trim()) {
      errorMessage = 'Stream URL is required'
      return
    }

    errorMessage = null
    successMessage = null
    try {
      const result = await dashboardState.addMatchStream(matchId, state)
      if (result.error) {
        errorMessage = result.error
        return
      }
      successMessage = result.success ?? 'Stream added.'
      streamForm = {
        ...streamForm,
        [matchId]: {
          platform: state.platform,
          streamUrl: '',
          displayName: '',
          status: state.status,
          isPrimary: false,
        },
      }
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to add stream'
    }
  }

  async function saveExistingMatchStream(matchId: string, streamId: string) {
    const state = existingStreamForm[streamId]
    if (!state?.streamUrl?.trim()) {
      errorMessage = 'Stream URL is required'
      return
    }

    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}/streams`, {
        method: 'PATCH',
        body: {
          streamId,
          platform: state.platform,
          streamUrl: state.streamUrl,
          displayName: state.displayName,
          status: state.status,
          isPrimary: state.isPrimary,
        },
        fallbackMessage: 'Failed to update stream',
      })
      successMessage = 'Stream updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update stream'
    }
  }

  async function createSeason() {
    if (!createSeasonCode.trim() || !createSeasonName.trim()) {
      errorMessage = 'Season code and name are required'
      return
    }

    isCreatingSeason = true
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/seasons', {
        method: 'POST',
        body: {
          code: createSeasonCode,
          name: createSeasonName,
          startsOn: createSeasonStartsOn || null,
          endsOn: createSeasonEndsOn || null,
          isActive: createSeasonIsActive,
        },
        fallbackMessage: 'Failed to create season',
      })
      successMessage = 'Season created.'
      createSeasonCode = ''
      createSeasonName = ''
      createSeasonStartsOn = ''
      createSeasonEndsOn = ''
      createSeasonIsActive = false
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to create season'
    } finally {
      isCreatingSeason = false
    }
  }

  async function saveSeason(seasonId: string) {
    const state = seasonEditForm[seasonId]
    if (!state) return

    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/seasons', {
        method: 'PATCH',
        body: {
          id: seasonId,
          code: state.code,
          name: state.name,
          startsOn: state.startsOn || null,
          endsOn: state.endsOn || null,
          isActive: Boolean(state.isActive),
          summary: state.summary || null,
          winnerTeamId: state.winnerTeamId || null,
          runnerUpTeamId: state.runnerUpTeamId || null,
          mvpProfileId: state.mvpProfileId || null,
          finalLeaderboardBatchId: state.finalLeaderboardBatchId || null,
        },
        fallbackMessage: 'Failed to update season',
      })
      successMessage = 'Season updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update season'
    }
  }

  let logoUploadingSeasonId = $state<string | null>(null)

  async function uploadSeasonLogo(seasonId: string, file: File) {
    logoUploadingSeasonId = seasonId
    errorMessage = null
    successMessage = null
    try {
      const form = new FormData()
      form.set('seasonId', seasonId)
      form.set('logo', file)

      await adminFormRequest('/api/admin/seasons/logo', {
        method: 'POST',
        body: form,
        fallbackMessage: 'Failed to upload season logo',
        includeHttpStatusInError: true,
      })

      successMessage = 'Season logo updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to upload season logo'
    } finally {
      logoUploadingSeasonId = null
    }
  }

  async function removeSeasonLogo(seasonId: string, seasonName: string) {
    if (!window.confirm(`Remove the logo for ${seasonName}?`)) return

    logoUploadingSeasonId = seasonId
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/seasons/logo?seasonId=${encodeURIComponent(seasonId)}`, {
        method: 'DELETE',
        fallbackMessage: 'Failed to remove season logo',
      })
      successMessage = 'Season logo removed.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove season logo'
    } finally {
      logoUploadingSeasonId = null
    }
  }

  async function savePlayoffPickem(
    seasonId: string,
    config: ReturnType<typeof normalizePlayoffPickemConfig>
  ) {
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/playoff-pickems/${seasonId}`, {
        method: 'PATCH',
        body: { config },
        fallbackMessage: "Failed to save playoff pick'em",
      })
      successMessage = "Playoff pick'em saved."
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Failed to save playoff pick'em"
    }
  }

  async function scorePlayoffPickem(seasonId: string) {
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{
        summary?: { submissionsScored?: number; completedMatches?: number }
      }>(`/api/admin/playoff-pickems/${seasonId}`, {
        method: 'POST',
        fallbackMessage: "Failed to score playoff pick'em",
      })
      successMessage = `Scored ${result.summary?.submissionsScored ?? 0} brackets from ${result.summary?.completedMatches ?? 0} completed matches.`
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : "Failed to score playoff pick'em"
    }
  }

  function requestUserRiotIdSave(userId: string, userName: string) {
    const riotIdBase = (userRiotIdForm[userId] ?? '').trim()
    pendingActionConfirmation = {
      kind: 'save_user_riot',
      userId,
      userName,
      riotIdBase,
      title: 'Confirm Riot ID Update',
      message: riotIdBase
        ? `Set ${userName}'s Riot ID to ${riotIdBase}?`
        : `Clear ${userName}'s Riot ID?`,
      confirmLabel: 'Save Riot ID',
    }
    showActionConfirmation = true
  }

  async function executeSaveUserRiotId(userId: string, riotIdBase: string) {
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest('/api/admin/users', {
        method: 'PATCH',
        body: { userId, riotIdBase },
        fallbackMessage: 'Failed to update Riot ID',
      })
      successMessage = 'Riot ID updated.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update Riot ID'
    }
  }

  function removeMatchStream(matchId: string, streamId: string, label: string) {
    pendingActionConfirmation = {
      kind: 'delete_stream',
      matchId,
      streamId,
      title: 'Confirm Stream Removal',
      message: `Remove stream ${label}? This will remove it from the public match page.`,
      confirmLabel: 'Remove Stream',
    }
    showActionConfirmation = true
  }

  async function executeRemoveMatchStream(matchId: string, streamId: string) {
    errorMessage = null
    successMessage = null
    try {
      await adminJsonRequest(`/api/admin/matches/${matchId}/streams`, {
        method: 'DELETE',
        body: { streamId },
        fallbackMessage: 'Failed to remove stream',
      })
      successMessage = 'Stream removed.'
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove stream'
    }
  }

  async function addPlayerToTeam(teamId: string) {
    const state = addPlayerForm[teamId] ?? { playerName: '', role: 'player' }
    if (!state.playerName.trim()) {
      errorMessage = 'Enter a player name to add'
      return
    }

    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'POST',
        body: { teamId, playerName: state.playerName.trim(), role: state.role },
        fallbackMessage: 'Failed to add player',
      })

      successMessage = 'Player added to team.'
      updateAddPlayerForm(teamId, { playerName: '', role: 'player' })
      await refreshData()
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to add player'
    }
  }

  function requestRoleChange(
    userId: string,
    userName: string,
    currentRole: string,
    newRole: string
  ) {
    if (currentRole === newRole) return
    pendingRoleChange = { userId, userName, currentRole, newRole }
    showRoleConfirmation = true
  }

  function cancelRoleChange() {
    showRoleConfirmation = false
    pendingRoleChange = null
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return

    isUpdatingRole = true
    errorMessage = null

    try {
      await adminJsonRequest('/api/admin/users', {
        method: 'PATCH',
        body: {
          userId: pendingRoleChange.userId,
          newRole: pendingRoleChange.newRole,
        },
        fallbackMessage: 'Failed to update role',
      })

      // Update local state
      users = users.map((u) =>
        u.id === pendingRoleChange!.userId ? { ...u, role: pendingRoleChange!.newRole } : u
      )

      successMessage = `Updated ${pendingRoleChange.userName} to ${pendingRoleChange.newRole}.`

      showRoleConfirmation = false
      pendingRoleChange = null
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update role'
    } finally {
      isUpdatingRole = false
    }
  }

  function removeApprovedTeam(teamId: string, teamName: string) {
    pendingActionConfirmation = {
      kind: 'remove_team',
      teamId,
      teamName,
      title: 'Confirm Team Removal',
      message: `Are you sure you want to remove approved team "${teamName}"? This will deactivate roster memberships.`,
      confirmLabel: 'Remove Team',
    }
    showActionConfirmation = true
  }

  async function executeRemoveApprovedTeam(teamId: string, teamName: string) {
    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'DELETE',
        body: { teamId },
        fallbackMessage: 'Failed to remove team',
      })

      approvedTeams = approvedTeams.filter((team) => team.id !== teamId)
      successMessage = `Removed team ${teamName}.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove team'
    } finally {
      processingTeamId = null
    }
  }

  function removeApprovedTeamPlayer(
    teamId: string,
    membershipId: number | null,
    profileId: string,
    riotId: string,
    role: string
  ) {
    const label = role === 'captain' ? `${riotId} (captain)` : riotId
    pendingActionConfirmation = {
      kind: 'remove_player',
      teamId,
      membershipId,
      profileId,
      riotId,
      role,
      title: 'Confirm Player Removal',
      message: `Remove ${label} from this team? This deactivates their membership immediately.`,
      confirmLabel: 'Remove Player',
    }
    showActionConfirmation = true
  }

  async function executeRemoveApprovedTeamPlayer(
    teamId: string,
    membershipId: number | null,
    profileId: string,
    riotId: string
  ) {
    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'PATCH',
        body: { teamId, profileId: profileId || null, membershipId },
        fallbackMessage: 'Failed to remove player',
      })

      approvedTeams = approvedTeams.map((team) => {
        if (team.id !== teamId) return team
        const nextRoster = (team.roster ?? []).filter(
          (player) => player.membership_id !== membershipId
        )
        return {
          ...team,
          roster: nextRoster,
          roster_count: Math.max(0, (team.roster_count ?? 0) - 1),
        }
      })
      successMessage = `Removed ${riotId} from team.`
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to remove player'
    } finally {
      processingTeamId = null
    }
  }

  /**
   * Starters drive the expected lineup shown on a match page before stats are
   * imported, so this is a plain toggle — no confirmation, and the roster is
   * patched locally rather than reloading the whole dashboard.
   */
  async function toggleTeamPlayerStarter(
    teamId: string,
    membershipId: number | null,
    isStarter: boolean
  ) {
    if (membershipId === null) {
      errorMessage = 'This membership predates starter tracking and cannot be toggled.'
      return
    }

    processingTeamId = teamId
    errorMessage = null
    successMessage = null

    try {
      await adminJsonRequest('/api/admin/teams/manage', {
        method: 'PATCH',
        body: { action: 'toggle_starter', membershipId, isStarter },
        fallbackMessage: 'Failed to update starter status',
      })

      approvedTeams = approvedTeams.map((team) => {
        if (team.id !== teamId) return team
        return {
          ...team,
          roster: (team.roster ?? []).map((player) =>
            player.membership_id === membershipId ? { ...player, is_starter: isStarter } : player
          ),
        }
      })
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to update starter status'
    } finally {
      processingTeamId = null
    }
  }

  function cancelActionConfirmation() {
    showActionConfirmation = false
    pendingActionConfirmation = null
  }

  async function confirmActionConfirmation() {
    if (!pendingActionConfirmation) return

    const action = pendingActionConfirmation
    showActionConfirmation = false
    pendingActionConfirmation = null

    if (action.kind === 'remove_team') {
      await executeRemoveApprovedTeam(action.teamId, action.teamName)
      return
    }

    if (action.kind === 'finalize_match') {
      await executeFinalizeMatch(action)
      return
    }

    if (action.kind === 'cancel_match') {
      await executeCancelMatch(action.matchId)
      return
    }

    if (action.kind === 'save_team') {
      await executeSaveTeamEdits(action.teamId)
      return
    }

    if (action.kind === 'save_match') {
      await executeSaveMatchEdits(action.matchId)
      return
    }

    if (action.kind === 'delete_match') {
      await executeDeleteMatch(action.matchId)
      return
    }

    if (action.kind === 'delete_stream') {
      await executeRemoveMatchStream(action.matchId, action.streamId)
      return
    }

    if (action.kind === 'save_user_riot') {
      await executeSaveUserRiotId(action.userId, action.riotIdBase)
      return
    }

    if (action.kind === 'remove_player') {
      await executeRemoveApprovedTeamPlayer(
        action.teamId,
        action.membershipId,
        action.profileId,
        action.riotId
      )
    }
  }
</script>

<PageContainer>
  <AdminDashboardShell
    {activeTab}
    counts={{
      users: users.length,
      teams: approvedTeams.length,
      matches: matches.length,
      seasons: seasons.length,
      accolades: accolades.length,
      hallOfFame: hallOfFameEntries.length,
      moderation: pendingReportCount,
      signups: pendingSignupCount,
    }}
    {isLoading}
    {errorMessage}
    {successMessage}
    onTabChange={(tab) => {
      activeTab = tab
      if (tab === 'accolades' && !accoladesLoaded) loadAccolades()
      if (tab === 'hall-of-fame' && !hallOfFameLoaded) loadHallOfFame()
      if (tab === 'moderation' && !commentReportsLoaded) loadCommentReports()
      if (tab === 'signups' && !signupsLoaded) loadSignups()
    }}
    onRefresh={refreshData}
  >
    {#if activeTab === 'users'}
      <AdminUsersTab
        {users}
        {displayedUsers}
        {usersSearch}
        {userRiotIdForm}
        onUsersSearchChange={(value) => (usersSearch = value)}
        onUserRiotIdInput={(userId, value) =>
          (userRiotIdForm = {
            ...userRiotIdForm,
            [userId]: value,
          })}
        onRequestRoleChange={requestRoleChange}
        onRequestUserRiotIdSave={requestUserRiotIdSave}
      />
    {/if}

    {#if activeTab === 'teams'}
      <AdminTeamsTab
        {teamsSearch}
        {createTeamName}
        {createTeamTag}
        {isCreatingTeam}
        {displayedApprovedTeams}
        {addPlayerForm}
        {teamEditForm}
        {processingTeamId}
        {matchSeasonOptions}
        {adminMatchSeasonId}
        {onMatchSeasonChange}
        onTeamsSearchChange={(value) => (teamsSearch = value)}
        onCreateTeamNameChange={(value) => (createTeamName = value)}
        onCreateTeamTagChange={(value) => (createTeamTag = value)}
        onCreateTeamLogoInput={(file, input) => {
          createTeamLogoFile = file
          createTeamLogoInput = input
        }}
        onCreateTeam={createTeam}
        onTeamEditChange={updateTeamEditForm}
        onTeamLogoChange={(teamId, file) =>
          (teamLogoFileById = {
            ...teamLogoFileById,
            [teamId]: file,
          })}
        onSaveTeam={saveTeamEdits}
        onAddPlayerChange={updateAddPlayerForm}
        onAddPlayer={addPlayerToTeam}
        onRemovePlayer={removeApprovedTeamPlayer}
        onToggleStarter={toggleTeamPlayerStarter}
        onRemoveTeam={removeApprovedTeam}
      />
    {/if}

    {#if activeTab === 'matches'}
      <AdminMatchesTab
        {approvedTeamOptions}
        {approvedTeams}
        {createMatchTeamAId}
        {createMatchTeamBId}
        {createMatchBestOf}
        {createMatchScheduledAt}
        {isCreatingMatch}
        {matches}
        {matchSearchQuery}
        {showCompletedAdminMatches}
        {filteredAdminMatches}
        {expandedAdminMatchId}
        {finalizeForm}
        {matchEditForm}
        {streamForm}
        {existingStreamForm}
        {vodForm}
        {matchMapsCache}
        {matchMapsLoading}
        {matchSeasonOptions}
        {adminMatchSeasonId}
        {onMatchSeasonChange}
        onCreateMatchTeamAIdChange={(value) => (createMatchTeamAId = value)}
        onCreateMatchTeamBIdChange={(value) => (createMatchTeamBId = value)}
        onCreateMatchBestOfChange={(value) => (createMatchBestOf = value as BestOfValue)}
        onCreateMatchScheduledAtChange={(value) => (createMatchScheduledAt = value)}
        onCreateMatch={createMatch}
        onMatchSearchChange={(value) => (matchSearchQuery = value)}
        onShowCompletedChange={(value) => (showCompletedAdminMatches = value)}
        onToggleExpandedMatch={(matchId) =>
          (expandedAdminMatchId = expandedAdminMatchId === matchId ? null : matchId)}
        onUpdateFinalizeForm={updateFinalizeForm}
        onFinalizeMatch={finalizeMatch}
        onCancelMatch={cancelMatch}
        onUpdateMatchEditForm={updateMatchEditForm}
        onSaveMatchEdits={saveMatchEdits}
        onDeleteMatch={deleteMatch}
        onUpdateExistingStreamForm={(streamId, patch) =>
          (existingStreamForm = {
            ...existingStreamForm,
            [streamId]: {
              ...(existingStreamForm[streamId] ?? {}),
              ...patch,
            },
          })}
        onSaveExistingMatchStream={saveExistingMatchStream}
        onRemoveMatchStream={removeMatchStream}
        onUpdateStreamForm={(matchId, patch) =>
          (streamForm = {
            ...streamForm,
            [matchId]: {
              ...(streamForm[matchId] ?? {}),
              ...patch,
            },
          })}
        onAddMatchStream={addMatchStream}
        onVodChange={(matchId, value) =>
          (vodForm = {
            ...vodForm,
            [matchId]: value,
          })}
        onFetchMatchMaps={fetchMatchMaps}
        onToggleMapVoided={toggleMapVoided}
      />
    {/if}

    {#if activeTab === 'seasons'}
      <AdminSeasonsTab
        {seasons}
        {approvedTeams}
        {matches}
        players={users}
        leaderboardBatches={data.leaderboardBatches ?? []}
        {createSeasonCode}
        {createSeasonName}
        {createSeasonStartsOn}
        {createSeasonEndsOn}
        {createSeasonIsActive}
        {isCreatingSeason}
        {seasonEditForm}
        onCreateSeasonCodeChange={(value) => (createSeasonCode = value)}
        onCreateSeasonNameChange={(value) => (createSeasonName = value)}
        onCreateSeasonStartsOnChange={(value) => (createSeasonStartsOn = value)}
        onCreateSeasonEndsOnChange={(value) => (createSeasonEndsOn = value)}
        onCreateSeasonIsActiveChange={(value) => (createSeasonIsActive = value)}
        onSeasonEditChange={(seasonId, nextState) =>
          (seasonEditForm = {
            ...seasonEditForm,
            [seasonId]: nextState,
          })}
        onCreateSeason={createSeason}
        onSaveSeason={saveSeason}
        onSavePlayoffPickem={savePlayoffPickem}
        onScorePlayoffPickem={scorePlayoffPickem}
        {logoUploadingSeasonId}
        onUploadSeasonLogo={uploadSeasonLogo}
        onRemoveSeasonLogo={removeSeasonLogo}
      />
    {/if}

    {#if activeTab === 'accolades'}
      <AdminAccoladesTab
        {accolades}
        {accoladesLoaded}
        {createAccoladeName}
        {createAccoladeIconKey}
        {isCreatingAccolade}
        {accoladeAssignProfileId}
        {accoladeAssignContext}
        {editingAccoladeId}
        {editAccoladeName}
        {accoladeLogoStatus}
        onCreateAccoladeNameChange={(value) => (createAccoladeName = value)}
        onCreateAccoladeIconKeyChange={(value) => (createAccoladeIconKey = value)}
        onCreateAccoladeLogoInput={(file) => (createAccoladeLogoFile = file)}
        onCreateAccolade={createAccolade}
        onEditAccolade={(accolade) => {
          editingAccoladeId = accolade.id
          editAccoladeName = accolade.name
        }}
        onCancelEditAccolade={() => {
          editingAccoladeId = null
          editAccoladeName = ''
        }}
        onEditAccoladeNameChange={(value) => (editAccoladeName = value)}
        onRenameAccolade={renameAccolade}
        onDeleteAccolade={deleteAccolade}
        onUpdateAccoladeLogo={updateAccoladeLogo}
        onAssignProfileChange={(accoladeId, value) =>
          (accoladeAssignProfileId = {
            ...accoladeAssignProfileId,
            [accoladeId]: value,
          })}
        onAssignContextChange={(accoladeId, value) =>
          (accoladeAssignContext = {
            ...accoladeAssignContext,
            [accoladeId]: value,
          })}
        onAssignAccolade={assignAccolade}
        onSetAccoladeIconKey={setAccoladeIconKey}
        onUnassignAccolade={unassignAccolade}
      />
    {/if}

    {#if activeTab === 'hall-of-fame'}
      <AdminHallOfFameTab
        entries={hallOfFameEntries}
        entriesLoaded={hallOfFameLoaded}
        createForm={hallOfFameCreateForm}
        editForm={hallOfFameEditForm}
        teamOptions={hofTeamOptions}
        playerOptions={hofPlayerOptions}
        seasonOptions={hofSeasonOptions}
        processingEntryId={processingHallOfFameId}
        isCreating={isCreatingHallOfFameEntry}
        onCreateFormChange={(patch) =>
          (hallOfFameCreateForm = { ...hallOfFameCreateForm, ...patch })}
        onEditFormChange={updateHallOfFameEditForm}
        onCreate={createHallOfFameEntry}
        onSave={saveHallOfFameEntry}
        onDelete={deleteHallOfFameEntry}
      />
    {/if}

    {#if activeTab === 'moderation'}
      <AdminModerationTab
        reports={commentReports}
        reportsLoaded={commentReportsLoaded}
        statusFilter={commentReportStatusFilter}
        {processingReportId}
        onStatusFilterChange={(value) => {
          commentReportStatusFilter = value
          loadCommentReports()
        }}
        onResolve={resolveReport}
        onDismiss={dismissReport}
        onDeleteComment={deleteReportedComment}
        onBanUser={banFromCommenting}
        onUnbanUser={unbanFromCommenting}
      />
    {/if}

    {#if activeTab === 'signups'}
      <AdminSignupsTab
        signups={playerSignups}
        {signupsLoaded}
        statusFilter={signupStatusFilter}
        editForm={signupEditForm}
        {processingSignupId}
        onStatusFilterChange={(value) => {
          signupStatusFilter = value
          loadSignups()
        }}
        onEditChange={updateSignupEditForm}
        {riotLookupSignupId}
        onFetchRiotRank={fetchRiotRank}
        {trackerLookupSignupId}
        onFetchTrackerScore={fetchTrackerScore}
        {bulkImportRunning}
        {bulkImportReport}
        onBulkImport={runSignupBulkImport}
        onDismissBulkReport={() => (bulkImportReport = null)}
        onSave={(signupId) => saveSignup(signupId)}
        onSetStatus={(signupId, status) => saveSignup(signupId, status)}
        onDelete={deleteSignup}
      />
    {/if}
  </AdminDashboardShell>

  <!-- Role Change Confirmation Modal -->
  {#if showRoleConfirmation && pendingRoleChange}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div
        class="w-full max-w-md rounded-lg border p-6 text-center"
        style="border-color: rgba(255, 255, 255, 0.45); background: var(--secondary-background);"
      >
        <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">Confirm Role Change</h3>
        <p class="mb-5 text-sm" style="color: var(--text);">
          Are you sure you want to change <strong>{pendingRoleChange.userName}</strong>'s role from
          <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold"
            >{pendingRoleChange.currentRole}</span
          >
          to
          <span class="rounded bg-white/10 px-2 py-1 text-xs font-semibold"
            >{pendingRoleChange.newRole}</span
          >?
        </p>
        <div class="flex justify-center gap-3">
          <button
            type="button"
            class="rounded-md border px-4 py-2"
            style="border-color: rgba(255,255,255,0.45); color: var(--text);"
            onclick={cancelRoleChange}
            disabled={isUpdatingRole}
          >
            Cancel
          </button>
          <button
            type="button"
            class="rounded-md px-4 py-2 font-semibold"
            style="background: var(--accent); color: var(--text);"
            onclick={confirmRoleChange}
            disabled={isUpdatingRole}
          >
            {isUpdatingRole ? 'Updating...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <AdminActionConfirmationModal
    open={showActionConfirmation && Boolean(pendingActionConfirmation)}
    title={pendingActionConfirmation?.title ?? ''}
    message={pendingActionConfirmation?.message ?? ''}
    confirmLabel={pendingActionConfirmation?.confirmLabel ?? 'Confirm'}
    onCancel={cancelActionConfirmation}
    onConfirm={confirmActionConfirmation}
  />
</PageContainer>
