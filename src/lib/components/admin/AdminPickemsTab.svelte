<script lang="ts">
  import { onMount } from 'svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { readRememberedAdminSeason, rememberAdminSeason } from '$lib/admin/remembered-season'
  import { Plus, Trash2 } from 'lucide-svelte'
  import {
    DE8_TOP_SEEDS,
    bracketOpponents,
    standardDoubleElim8Template,
    type PickemFeed,
    type PickemFormat,
    type PickemSeed,
  } from '$lib/pickems'
  import type { AdminSeason, SeasonMatchEntry, SeasonTeamEntry } from '$lib/admin/types'

  /** One editable prediction unit — mirrors a `pickem_matches` row. */
  type EditMatch = {
    slotKey: string
    groupKey: string
    sortOrder: number
    label: string
    points: number
    teamAId: string | null
    teamBId: string | null
    feedA: PickemFeed | null
    feedB: PickemFeed | null
    linkedMatchId: string | null
    actualWinnerId: string | null
  }

  type PickemForm = {
    format: PickemFormat
    title: string
    status: string
    lockAt: string
    /** Bracket: seeds 1–4 only — nothing below the top four is seeded. */
    seeds: PickemSeed[]
    /** Bracket: seed → the team that seed picked to face in its QF. */
    opponents: Record<number, string>
    matches: EditMatch[]
  }

  type PickemData = {
    seasonId: string
    format: string
    title: string
    status: string
    lockAt: string | null
    seeds: Array<{ seed: number; teamId: string }>
    matches: Array<Omit<EditMatch, 'feedA' | 'feedB'> & { feedA: unknown; feedB: unknown }>
  }

  interface Props {
    seasons: AdminSeason[]
    seasonTeams?: SeasonTeamEntry[]
    seasonMatches?: SeasonMatchEntry[]
    pickems?: PickemData[]
    /** Team id → standings rank, to prefill the top seeds. */
    standings?: Record<string, number>
    onSavePickem: (seasonId: string, body: Record<string, unknown>) => void
  }

  let {
    seasons,
    seasonTeams = [],
    seasonMatches = [],
    pickems = [],
    standings = {},
    onSavePickem,
  }: Props = $props()

  let selectedSeasonId = $state<string>(seasons[0]?.id ?? '')

  onMount(() => {
    const remembered = readRememberedAdminSeason(seasons.map((s) => s.id))
    if (remembered) selectedSeasonId = remembered
  })
  // Edits are held per season so switching rows does not lose work.
  let forms = $state<Record<string, PickemForm>>({})

  const seasonOptions = $derived(
    seasons.map((s) => ({ value: s.id, label: `${s.name}${s.is_active ? ' (Active)' : ''}` }))
  )

  const formatOptions = [
    { value: 'bracket', label: 'Playoff bracket' },
    { value: 'matchups', label: 'Weekly matchups' },
  ]
  // Open entries lock on their own at "Locks at", and the pick'em goes final on
  // its own once every match has a result — Locked/Final are only overrides.
  const statusOptions = [
    { value: 'draft', label: 'Draft (hidden)' },
    { value: 'open', label: 'Open' },
    { value: 'locked', label: 'Locked now' },
    { value: 'scored', label: 'Final now' },
  ]

  function normalizeFeed(value: unknown): PickemFeed | null {
    if (!value || typeof value !== 'object') return null
    const raw = value as Record<string, unknown>
    if (raw.type === 'seed' && Number.isInteger(Number(raw.seed))) {
      return { type: 'seed', seed: Number(raw.seed) }
    }
    if ((raw.type === 'winner' || raw.type === 'loser') && typeof raw.of === 'string') {
      return { type: raw.type, of: raw.of }
    }
    return null
  }

  /** A season's teams, best standings rank first, then by name. */
  function rankedTeams(seasonId: string) {
    const rank = (id: string) => standings[id] ?? Number.MAX_SAFE_INTEGER
    return seasonTeams
      .filter((t) => t.season_id === seasonId)
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
  }

  /** Seeds 1–4 from the standings, when the season has any. */
  function seedsFromStandings(seasonId: string): PickemSeed[] {
    return rankedTeams(seasonId)
      .filter((t) => standings[t.id] != null)
      .slice(0, DE8_TOP_SEEDS.length)
      .map((t, i) => ({ seed: i + 1, teamId: t.id }))
  }

  /** Build the initial editable form for a season from its stored event. */
  function initialForm(seasonId: string): PickemForm {
    const stored = pickems.find((p) => p.seasonId === seasonId)
    if (!stored) {
      return {
        format: 'bracket',
        title: seasons.find((s) => s.id === seasonId)?.name ?? '',
        status: 'draft',
        lockAt: '',
        seeds: seedsFromStandings(seasonId),
        opponents: {},
        matches: [],
      }
    }
    const allSeeds = (stored.seeds ?? []).map((s) => ({ seed: s.seed, teamId: s.teamId }))
    const matches = (stored.matches ?? []).map((m) => ({
      slotKey: m.slotKey,
      groupKey: m.groupKey ?? '',
      sortOrder: m.sortOrder ?? 0,
      label: m.label ?? '',
      points: m.points ?? 1,
      teamAId: m.teamAId ?? null,
      teamBId: m.teamBId ?? null,
      feedA: normalizeFeed(m.feedA),
      feedB: normalizeFeed(m.feedB),
      linkedMatchId: m.linkedMatchId ?? null,
      actualWinnerId: m.actualWinnerId ?? null,
    }))
    // Older brackets seeded all eight teams; read their opponents back from the QFs.
    const opponents: Record<number, string> = {}
    for (const [seed, teamId] of Object.entries(bracketOpponents({ seeds: allSeeds }, matches))) {
      if (teamId) opponents[Number(seed)] = teamId
    }
    return {
      format: (stored.format as PickemFormat) === 'matchups' ? 'matchups' : 'bracket',
      title: stored.title ?? '',
      status: stored.status ?? 'draft',
      lockAt: stored.lockAt ? stored.lockAt.slice(0, 16) : '',
      seeds: allSeeds.filter((s) => s.seed <= DE8_TOP_SEEDS.length),
      opponents,
      matches,
    }
  }

  const form = $derived.by(() => {
    if (!selectedSeasonId) return null
    return forms[selectedSeasonId] ?? initialForm(selectedSeasonId)
  })

  function patchForm(patch: Partial<PickemForm>) {
    if (!selectedSeasonId || !form) return
    forms = { ...forms, [selectedSeasonId]: { ...form, ...patch } }
  }

  function resetForm() {
    if (!selectedSeasonId) return
    forms = { ...forms, [selectedSeasonId]: initialForm(selectedSeasonId) }
  }

  // ---- Team / match option helpers, scoped to the selected season ----

  const teamLabel = (t: { name: string; tag: string | null }) =>
    t.name + (t.tag ? ` (${t.tag})` : '')

  const seasonTeamList = $derived(rankedTeams(selectedSeasonId))

  const teamOptions = $derived([
    { value: '', label: '— None —' },
    ...seasonTeamList.map((t) => ({ value: t.id, label: teamLabel(t) })),
  ])

  /** Team choices for one bracket spot, leaving out teams already placed elsewhere. */
  function bracketTeamOptions(current: string) {
    const placed = new Set([
      ...(form?.seeds.map((s) => s.teamId) ?? []),
      ...Object.values(form?.opponents ?? {}),
    ])
    return [
      { value: '', label: '— None —' },
      ...seasonTeamList
        .filter((t) => t.id === current || !placed.has(t.id))
        .map((t) => {
          const rank = standings[t.id]
          return { value: t.id, label: `${rank ? `#${rank} ` : ''}${teamLabel(t)}` }
        }),
    ]
  }

  function matchLabelFor(match: SeasonMatchEntry) {
    const a = Array.isArray(match.team_a) ? match.team_a[0] : match.team_a
    const b = Array.isArray(match.team_b) ? match.team_b[0] : match.team_b
    const names = `${a?.name ?? 'Team A'} vs ${b?.name ?? 'Team B'}`
    return match.scheduled_at
      ? `${names} — ${new Date(match.scheduled_at).toLocaleDateString()}`
      : names
  }

  const matchOptions = $derived([
    { value: '', label: 'Auto-detect' },
    ...seasonMatches
      .filter((m) => m.season_id === selectedSeasonId && m.team_a_id && m.team_b_id)
      .map((m) => ({ value: m.id, label: matchLabelFor(m) })),
  ])

  // ---- Bracket ----

  function seedTeam(seed: number): string {
    return form?.seeds.find((s) => s.seed === seed)?.teamId ?? ''
  }

  function setSeed(seed: number, teamId: string) {
    if (!form) return
    const seeds = form.seeds.filter((s) => s.seed !== seed)
    if (teamId) seeds.push({ seed, teamId })
    seeds.sort((a, b) => a.seed - b.seed)
    patchForm({ seeds })
  }

  function opponentTeam(seed: number): string {
    return form?.opponents[seed] ?? ''
  }

  function setOpponent(seed: number, teamId: string) {
    if (!form) return
    const opponents = { ...form.opponents }
    if (teamId) opponents[seed] = teamId
    else delete opponents[seed]
    patchForm({ opponents })
  }

  function fillSeedsFromStandings() {
    if (!selectedSeasonId || !form) return
    const seeds = seedsFromStandings(selectedSeasonId)
    const seeded = new Set(seeds.map((s) => s.teamId))
    // An opponent that just became a seed can't be both.
    const opponents = Object.fromEntries(
      Object.entries(form.opponents).filter(([, id]) => !seeded.has(id))
    )
    patchForm({ seeds, opponents })
  }

  const hasStandings = $derived(seasonTeamList.some((t) => standings[t.id] != null))

  /**
   * The bracket's slots with their overrides. The server rebuilds the same
   * template on save, so the rows only need to carry those overrides.
   */
  const bracketSlots = $derived.by(() => {
    if (!form) return [] as EditMatch[]
    const stored = new Map(form.matches.map((m) => [m.slotKey, m]))
    return standardDoubleElim8Template().map((m) => ({
      ...m,
      linkedMatchId: stored.get(m.slotKey)?.linkedMatchId ?? null,
      actualWinnerId: stored.get(m.slotKey)?.actualWinnerId ?? null,
    }))
  })

  function updateBracketSlot(slotKey: string, patch: Partial<EditMatch>) {
    patchForm({
      matches: bracketSlots.map((m) => (m.slotKey === slotKey ? { ...m, ...patch } : m)),
    })
  }

  const bracketOverrideCount = $derived(
    bracketSlots.filter((m) => m.linkedMatchId || m.actualWinnerId).length
  )

  // ---- Matchups ----

  function newSlotKey() {
    return `m_${crypto.randomUUID().slice(0, 8)}`
  }

  /** Weeks, in first-seen order, with their matches. */
  const weeks = $derived.by(() => {
    if (!form) return [] as Array<{ label: string; matches: EditMatch[] }>
    const order: string[] = []
    const byWeek = new Map<string, EditMatch[]>()
    for (const m of form.matches) {
      const key = m.groupKey || 'Week 1'
      if (!byWeek.has(key)) {
        byWeek.set(key, [])
        order.push(key)
      }
      byWeek.get(key)!.push(m)
    }
    return order.map((label) => ({ label, matches: byWeek.get(label)! }))
  })

  function addWeek() {
    if (!form) return
    const label = `Week ${weeks.length + 1}`
    addMatchToWeek(label)
  }

  function addMatchToWeek(weekLabel: string) {
    if (!form) return
    const count = form.matches.filter((m) => (m.groupKey || 'Week 1') === weekLabel).length
    const match: EditMatch = {
      slotKey: newSlotKey(),
      groupKey: weekLabel,
      sortOrder: form.matches.length,
      label: `${weekLabel} · Match ${count + 1}`,
      points: 1,
      teamAId: null,
      teamBId: null,
      feedA: null,
      feedB: null,
      linkedMatchId: null,
      actualWinnerId: null,
    }
    patchForm({ matches: [...form.matches, match] })
  }

  function updateMatch(slotKey: string, patch: Partial<EditMatch>) {
    if (!form) return
    patchForm({
      matches: form.matches.map((m) => (m.slotKey === slotKey ? { ...m, ...patch } : m)),
    })
  }

  function removeMatch(slotKey: string) {
    if (!form) return
    patchForm({
      matches: form.matches
        .filter((m) => m.slotKey !== slotKey)
        .map((m, i) => ({ ...m, sortOrder: i })),
    })
  }

  // ---- Save ----

  function save() {
    if (!selectedSeasonId || !form) return
    onSavePickem(selectedSeasonId, {
      format: form.format,
      title: form.title,
      status: form.status,
      lockAt: form.lockAt ? new Date(form.lockAt).toISOString() : null,
      seeds: form.seeds,
      opponents: form.opponents,
      matches: form.format === 'bracket' ? bracketSlots : form.matches,
    })
  }
</script>

<div class="grid grid-cols-1 gap-4">
  <section class="admin-bordered p-3">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div
        class="text-sm font-semibold tracking-wide uppercase"
        style="color: rgba(255,255,255,0.8);"
      >
        Pick'em
      </div>
      <div class="min-w-[220px]">
        <CustomSelect
          options={seasonOptions}
          value={selectedSeasonId}
          compact={true}
          placeholder="Select a season"
          onSelect={(value) => {
            selectedSeasonId = value
            rememberAdminSeason(value)
          }}
        />
      </div>
    </div>

    {#if !selectedSeasonId}
      <div class="py-10 text-center text-sm" style="color: rgba(255,255,255,0.72);">
        Select a season to configure its pick'em.
      </div>
    {:else if form}
      <!-- Common controls -->
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label class="text-xs" style="color: rgba(255,255,255,0.82);">
          Format
          <div class="mt-1">
            <CustomSelect
              options={formatOptions}
              value={form.format}
              compact={true}
              onSelect={(value) => patchForm({ format: value as PickemFormat })}
            />
          </div>
        </label>
        <label class="text-xs" style="color: rgba(255,255,255,0.82);">
          Status
          <div class="mt-1">
            <CustomSelect
              options={statusOptions}
              value={form.status}
              compact={true}
              onSelect={(value) => patchForm({ status: value })}
            />
          </div>
        </label>
        <label class="text-xs" style="color: rgba(255,255,255,0.82);">
          Title
          <input
            value={form.title}
            class="admin-input mt-1"
            placeholder="Shown on the pick'em page"
            oninput={(e) => patchForm({ title: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label class="text-xs" style="color: rgba(255,255,255,0.82);">
          Locks at
          <input
            type="datetime-local"
            value={form.lockAt}
            class="admin-input mt-1"
            oninput={(e) => patchForm({ lockAt: (e.currentTarget as HTMLInputElement).value })}
          />
        </label>
      </div>
      <p class="admin-hint mt-2">
        Entries close by themselves at the lock time. Results and scores come straight from the real
        matches as they finish, so you don't need to link games or press anything to score.
      </p>

      {#if form.format === 'bracket'}
        <!-- Top seeds and their picked opponents -->
        <div class="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.68);"
          >
            Quarter-finals — top 4 seeds pick their opponent
          </div>
          {#if hasStandings}
            <button
              type="button"
              class="admin-btn admin-btn-sm admin-btn-neutral"
              onclick={fillSeedsFromStandings}
            >
              Fill top 4 from standings
            </button>
          {/if}
        </div>
        <div class="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {#each DE8_TOP_SEEDS as seed (seed)}
            <div
              class="grid grid-cols-[1fr_auto_1fr] items-end gap-2 rounded-md border p-2"
              style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.15);"
            >
              <div>
                <div class="mb-1 text-xs font-semibold" style="color: rgba(255,255,255,0.68);">
                  Seed {seed}
                </div>
                <CustomSelect
                  options={bracketTeamOptions(seedTeam(seed))}
                  value={seedTeam(seed)}
                  compact={true}
                  placeholder="Select team"
                  onSelect={(value) => setSeed(seed, value)}
                />
              </div>
              <span class="pb-2 text-xs" style="color: rgba(255,255,255,0.45);">vs</span>
              <div>
                <div class="mb-1 text-xs font-semibold" style="color: rgba(255,255,255,0.68);">
                  Picked opponent
                </div>
                <CustomSelect
                  options={bracketTeamOptions(opponentTeam(seed))}
                  value={opponentTeam(seed)}
                  compact={true}
                  placeholder="Select team"
                  onSelect={(value) => setOpponent(seed, value)}
                />
              </div>
            </div>
          {/each}
        </div>
        <p class="admin-hint mt-2">
          Seeds 1 and 4 share a half of the bracket, as do 2 and 3. The rest of the 8-team double
          elimination bracket is built for you.
        </p>

        <details class="mt-4">
          <summary
            class="cursor-pointer text-xs font-semibold"
            style="color: rgba(255,255,255,0.68);"
          >
            Result overrides{bracketOverrideCount > 0 ? ` (${bracketOverrideCount})` : ''} — only if a
            result is detected wrong
          </summary>
          <p class="admin-hint mt-2">
            Each slot's result is the playoff match between its two teams. Pin a specific match if
            that guess is wrong, or set a winner for a game decided before entries opened (it scores
            no points).
          </p>
          <div class="mt-2 grid grid-cols-1 gap-2">
            {#each bracketSlots as match (match.slotKey)}
              <div
                class="grid grid-cols-1 items-center gap-2 rounded-md border p-2 sm:grid-cols-[9rem_1fr_1fr]"
                style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.15);"
              >
                <span class="text-xs font-semibold" style="color: rgba(255,255,255,0.7);">
                  {match.label}
                  <span class="font-normal" style="color: rgba(255,255,255,0.4);">
                    · {match.points}pt{match.points !== 1 ? 's' : ''}
                  </span>
                </span>
                <CustomSelect
                  options={matchOptions}
                  value={match.linkedMatchId ?? ''}
                  compact={true}
                  placeholder="Auto-detect"
                  onSelect={(value) =>
                    updateBracketSlot(match.slotKey, { linkedMatchId: value || null })}
                />
                <CustomSelect
                  options={teamOptions}
                  value={match.actualWinnerId ?? ''}
                  compact={true}
                  placeholder="Decided beforehand (no points)"
                  onSelect={(value) =>
                    updateBracketSlot(match.slotKey, { actualWinnerId: value || null })}
                />
              </div>
            {/each}
          </div>
        </details>
      {:else}
        <!-- Weekly matchups -->
        <div class="mt-4 flex items-center justify-between gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.68);"
          >
            Weeks
          </div>
          <button type="button" class="admin-btn admin-btn-sm admin-btn-neutral" onclick={addWeek}>
            <Plus size={13} /> Add week
          </button>
        </div>
        <p class="admin-hint mt-2">
          Pick the two teams; the result is the next match between them after the lock time. Pick a
          specific game instead only if that would choose the wrong one.
        </p>

        {#if weeks.length === 0}
          <div class="mt-2 text-sm" style="color: rgba(255,255,255,0.6);">
            No matchups yet — add a week to begin.
          </div>
        {/if}

        {#each weeks as week (week.label)}
          <div
            class="mt-3 rounded-md border p-2"
            style="border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.03);"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-sm font-semibold" style="color: var(--text);">{week.label}</span>
              <button
                type="button"
                class="admin-btn admin-btn-sm admin-btn-neutral"
                onclick={() => addMatchToWeek(week.label)}
              >
                <Plus size={13} /> Add match
              </button>
            </div>
            <div class="grid grid-cols-1 gap-2">
              {#each week.matches as match (match.slotKey)}
                <div
                  class="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1fr_4.5rem_auto]"
                  style="border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.15);"
                >
                  <CustomSelect
                    options={teamOptions}
                    value={match.teamAId ?? ''}
                    compact={true}
                    placeholder="Team A"
                    onSelect={(value) => updateMatch(match.slotKey, { teamAId: value || null })}
                  />
                  <CustomSelect
                    options={teamOptions}
                    value={match.teamBId ?? ''}
                    compact={true}
                    placeholder="Team B"
                    onSelect={(value) => updateMatch(match.slotKey, { teamBId: value || null })}
                  />
                  <CustomSelect
                    options={matchOptions}
                    value={match.linkedMatchId ?? ''}
                    compact={true}
                    placeholder="Auto-detect"
                    onSelect={(value) =>
                      updateMatch(match.slotKey, { linkedMatchId: value || null })}
                  />
                  <input
                    type="number"
                    min="0"
                    value={match.points}
                    class="admin-input"
                    title="Points"
                    oninput={(e) =>
                      updateMatch(match.slotKey, {
                        points: Math.max(
                          0,
                          Number((e.currentTarget as HTMLInputElement).value) || 0
                        ),
                      })}
                  />
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-danger"
                    title="Remove match"
                    aria-label="Remove match"
                    onclick={() => removeMatch(match.slotKey)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}

      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" class="admin-btn admin-btn-neutral text-sm" onclick={resetForm}>
          Reset
        </button>
        <button type="button" class="admin-btn admin-btn-info text-sm" onclick={save}>
          Save Pick'em
        </button>
      </div>
    {/if}
  </section>
</div>
