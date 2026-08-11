<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import CommentThread from '$lib/components/CommentThread.svelte'
  import { User, ExternalLink } from 'lucide-svelte'
  import DiscordIcon from '$lib/components/icons/DiscordIcon.svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import { resolve } from '$app/paths'
  import miksIcon from '$lib/assets/agents/Miks_icon.webp'
  import { builtInAccoladeIcons } from '$lib/accolades/icons'
  import { enhance } from '$app/forms'
  import { rankImageKey } from '$lib/ranks/ranks'

  let { data, form }: PageProps = $props()

  const player = $derived(data.player)
  const activeTeam = $derived(data.activeTeam)
  const viewer = $derived(data.viewer ?? { canEditRiotIdBase: false })
  const selected = $derived((data.stats?.selected ?? null) as any | null)
  const selectedBatchId = $derived((data.stats?.selectedBatchId ?? null) as string | null)
  const allBatchOptions = $derived(
    (data.stats?.batchOptions ?? []) as Array<{
      label: string
      value: string
      import_kind?: string | null
      week_label?: string | null
    }>
  )
  let hideWeeks = $state(false)
  function isWeekBatch(b: {
    import_kind?: string | null
    week_label?: string | null
    label?: string | null
  }) {
    if (b.import_kind === 'weekly') return true
    if (b.week_label) return true
    if (typeof b.label === 'string' && /week/i.test(b.label)) return true
    return false
  }
  const hasAnyWeeks = $derived(allBatchOptions.some((b) => isWeekBatch(b)))
  const batchOptions = $derived(
    hideWeeks ? allBatchOptions.filter((b) => !isWeekBatch(b)) : allBatchOptions
  )
  const matchHistory = $derived((data.matchHistory ?? []) as any[])
  const mapStats = $derived(
    (data.mapStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      maps_decided: number
      rounds: number
      acs: number | null
      kills: number
      deaths: number
      assists: number
      kd: number | null
      adr: number | null
      kast_pct: number | null
      hs_pct: number | null
      fk: number
      fd: number
      win_pct: number | null
    }>
  )
  const agentStats = $derived(
    (data.agentStats ?? []) as Array<{
      key: string
      maps_played: number
      maps_won: number
      maps_decided: number
      rounds: number
      acs: number | null
      kills: number
      deaths: number
      assists: number
      kd: number | null
      adr: number | null
      kast_pct: number | null
      hs_pct: number | null
      fk: number
      fd: number
      win_pct: number | null
    }>
  )
  const accolades = $derived(
    (data.accolades ?? []) as Array<{
      id: string
      name: string
      icon_key: string | null
      context: string | null
      logo_url: string | null
    }>
  )

  let riotIdBaseValue = $state('')
  let statsPlayerNameValue = $state('')
  $effect(() => {
    riotIdBaseValue = player.riot_id_base ?? ''
    statsPlayerNameValue = player.stats_player_name ?? ''
  })

  const agentAssetModules = import.meta.glob('$lib/assets/agents/*_icon.webp', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const agentIconMap = $derived.by(() => {
    const map = new SvelteMap<string, string>()
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const [path, url] of Object.entries(agentAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const base = filename.replace(/_icon\.webp$/i, '')
      map.set(normalize(base), url)
    }
    if (map.has('harbor')) map.set('harbour', map.get('harbor')!)
    map.set('miks', miksIcon)
    return map
  })

  function agentIconUrl(agentName: string): string | null {
    const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
    return agentIconMap.get(normalize(agentName)) ?? null
  }

  const rankAssetModules = import.meta.glob('$lib/assets/ranks/*_Rank.png', {
    eager: true,
    import: 'default',
  }) as Record<string, string>

  const rankIconMap = $derived.by(() => {
    const map = new SvelteMap<string, string>()
    for (const [path, url] of Object.entries(rankAssetModules)) {
      const filename = path.split('/').pop() ?? ''
      const key = filename.replace(/\.png$/i, '')
      map.set(key, url)
    }
    return map
  })

  function rankIconUrl(leagueRank: unknown): string | null {
    if (typeof leagueRank !== 'string') return null
    const key = rankImageKey(leagueRank)
    return key ? (rankIconMap.get(key) ?? null) : null
  }

  const playerRank = $derived((data.bestRank ?? null) as string | null)

  function parseAgents(value: unknown): string[] {
    if (typeof value !== 'string') return []
    const tokens = value
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
    return Array.from(new Set(tokens))
  }

  function fmt(n: unknown, digits = 1) {
    const v = Number(n)
    if (!Number.isFinite(v)) return '—'
    return v.toFixed(digits)
  }

  function navToBatch(batchId: string) {
    window.location.href = `/players/${player.profile_id}?batchId=${encodeURIComponent(batchId)}`
  }

  function formatLocal(value: string | null | undefined) {
    if (!value) return 'Date TBD'
    const date = new Date(value)
    return date.toLocaleString(undefined, { timeZoneName: 'short' })
  }

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="page-content min-w-0">
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-start gap-4">
          {#if activeTeam?.logo_url}
            <img
              src={activeTeam.logo_url}
              alt="{activeTeam.name} logo"
              class="h-20 w-20 rounded object-contain md:h-24 md:w-24"
            />
          {:else}
            <div
              class="flex h-20 w-20 items-center justify-center rounded border md:h-24 md:w-24"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
            >
              <User size={34} style="color: var(--text);" />
            </div>
          {/if}
          <div>
            <div class="flex flex-wrap items-end gap-2">
              <h1 class="responsive-title leading-none">{player.riot_id}</h1>
              {#if playerRank}
                {@const rUrl = rankIconUrl(playerRank)}
                {#if rUrl}
                  <img
                    src={rUrl}
                    alt={playerRank}
                    title={playerRank}
                    class="h-8 w-8 object-contain sm:h-10 sm:w-10"
                  />
                {/if}
              {/if}
              {#each accolades as accolade, i (accolade.id + '-' + i)}
                {@const iconSrc = accolade.icon_key
                  ? (builtInAccoladeIcons[accolade.icon_key] ?? null)
                  : null}
                {@const tooltip = accolade.context
                  ? `${accolade.name} — ${accolade.context}`
                  : accolade.name}
                {#if iconSrc || accolade.logo_url}
                  <img
                    src={iconSrc ?? accolade.logo_url}
                    alt={accolade.name}
                    title={tooltip}
                    class="accolade-icon h-5 w-5 rounded object-contain sm:h-7 sm:w-7 md:h-9 md:w-9"
                  />
                {:else}
                  <span
                    class="accolade-icon inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold sm:text-xs"
                    style="border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8);"
                    title={tooltip}
                  >
                    {accolade.name}
                  </span>
                {/if}
              {/each}
            </div>
            <!-- Team identity and contact links share one line; contacts are
                 published only once a signup is approved. -->
            <div class="identity-row">
              {#if activeTeam}
                <a
                  href={resolve(`/teams/${activeTeam.id}`)}
                  class="inline-flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-white/5"
                  style="color: var(--text);"
                >
                  <span class="font-medium" style="color: rgba(255,255,255,0.88);"
                    >{activeTeam.name}</span
                  >
                  {#if activeTeam.tag}
                    <span class="text-sm" style="color: rgba(255,255,255,0.62);"
                      >[{String(activeTeam.tag).toUpperCase()}]</span
                    >
                  {/if}
                  {#if activeTeam.role}
                    <span class="text-sm capitalize" style="color: rgba(255,255,255,0.52);"
                      >{activeTeam.role}</span
                    >
                  {/if}
                </a>
              {:else}
                <span class="text-sm" style="color: rgba(255,255,255,0.72);">No active team</span>
              {/if}

              {#if player.discord_handle || (player.tracker_links ?? []).length > 0}
                <span class="identity-divider"></span>
              {/if}

              {#if player.discord_handle}
                <span class="contact-chip" title="Discord">
                  <DiscordIcon size={13} />
                  {player.discord_handle}
                </span>
              {/if}
              {#each player.tracker_links ?? [] as link (link.url)}
                <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="contact-chip contact-chip-link"
                >
                  <ExternalLink size={12} />
                  {link.label}
                </a>
              {/each}
            </div>
          </div>
        </div>

        <div></div>
      </div>

      <section
        class="overflow-hidden rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        {#if viewer.canEditRiotIdBase && !player.riot_id_base}
          <div
            class="mb-4 rounded-md border p-3"
            style="border-color: rgba(59,130,246,0.25); background: rgba(59,130,246,0.10);"
          >
            <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
              Link Your Stats
            </div>
            <div class="text-xs" style="color: rgba(255,255,255,0.72);">
              Enter your Riot name (base only, no #tag). Admin stat imports match on this.
            </div>

            <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
              <input
                name="riot_id_base"
                bind:value={riotIdBaseValue}
                class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                placeholder="Example: Ginzburg"
                autocomplete="off"
              />
              <button
                type="submit"
                formaction="?/setRiotIdBase"
                class="rounded-md px-3 py-2 text-sm font-semibold"
                style="background: rgba(74,222,128,0.2); color: #4ade80;"
              >
                Save
              </button>
            </form>

            {#if form?.success === false}
              <div
                class="mt-2 rounded-md border p-2 text-sm"
                style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
              >
                {form.message ?? 'Failed to save'}
              </div>
            {/if}
          </div>
        {/if}

        {#if viewer.canEditRiotIdBase && player.has_unmatched_stats_candidate}
          <div
            class="mb-4 rounded-md border p-3"
            style="border-color: rgba(168,85,247,0.25); background: rgba(168,85,247,0.10);"
          >
            <div class="mb-1 text-sm font-semibold" style="color: rgba(255,255,255,0.92);">
              Alternate Stats Name
            </div>
            <div class="text-xs" style="color: rgba(255,255,255,0.72);">
              Use this when imported stats still list an old Riot or display name. This will also
              try to relink past imported stats.
            </div>

            <form class="mt-3 flex flex-col gap-2 md:flex-row" method="POST" use:enhance>
              <input
                name="stats_player_name"
                bind:value={statsPlayerNameValue}
                class="w-full flex-1 rounded-md border px-3 py-2 text-sm"
                style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                placeholder="Example: OldName"
                autocomplete="off"
              />
              <button
                type="submit"
                formaction="?/setStatsPlayerName"
                class="rounded-md px-3 py-2 text-sm font-semibold"
                style="background: rgba(168,85,247,0.2); color: #d8b4fe;"
              >
                Save Alt Name
              </button>
            </form>
          </div>
        {/if}

        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Stats
          </div>
          <div class="flex items-center gap-2">
            {#if hasAnyWeeks}
              <button
                type="button"
                class="rounded-md border px-3 py-2 text-xs"
                style={hideWeeks
                  ? 'border-color: rgba(59,130,246,0.5); background: rgba(59,130,246,0.18); color: #93c5fd;'
                  : 'border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.72);'}
                onclick={() => (hideWeeks = !hideWeeks)}
              >
                Hide Weeks
              </button>
            {/if}
            {#if batchOptions.length > 0}
              <div class="min-w-[260px]">
                <CustomSelect
                  options={batchOptions}
                  value={selectedBatchId ?? ''}
                  compact={true}
                  onSelect={navToBatch}
                />
              </div>
            {/if}
          </div>
        </div>

        {#if !selected}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            No imported stats found for this player.
          </p>
        {:else}
          <div class="mb-3 text-sm" style="color: rgba(255,255,255,0.78);">
            {selected.batch?.display_name ?? selected.import_batch_id}
            {#if selected.batch?.import_kind === 'weekly' && selected.batch?.week_label}
              <span class="opacity-80"> • {selected.batch.week_label}</span>
            {/if}
          </div>

          <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">Games</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {selected.games ?? '—'}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">ACS</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.acs, 0)}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">K/D</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.kd, 2)}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">ADR</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.adr, 0)}
              </div>
            </div>
            <div
              class="rounded-md border p-3"
              style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
            >
              <div class="text-xs" style="color: rgba(255,255,255,0.65);">HS%</div>
              <div class="text-lg font-semibold" style="color: var(--text);">
                {fmt(selected.hs_pct, 0)}
              </div>
            </div>
          </div>

          <div
            class="mt-4 rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <div class="mb-2 flex items-center gap-2">
              <div
                class="text-xs font-semibold tracking-wide uppercase"
                style="color: rgba(255,255,255,0.72);"
              >
                Agents
              </div>
            </div>
            {#if parseAgents(selected.agents).length === 0}
              <div class="text-sm" style="color: rgba(255,255,255,0.72);">—</div>
            {:else}
              <div class="agents-icons">
                {#each parseAgents(selected.agents) as agent (agent)}
                  {@const url = agentIconUrl(agent)}
                  {#if url}
                    <img
                      src={url}
                      alt={agent}
                      title={agent}
                      class="h-7 w-7 rounded-sm object-contain"
                      style="background: rgba(0,0,0,0.15);"
                    />
                  {:else}
                    <span
                      class="inline-flex h-7 w-7 items-center justify-center rounded-sm border text-[10px] font-bold"
                      style="border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8);"
                      title={agent}
                    >
                      {agent.slice(0, 3).toUpperCase()}
                    </span>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </section>

      {#if mapStats.length > 0 || agentStats.length > 0}
        <div class="mt-4 flex flex-col gap-4">
          {#if mapStats.length > 0}
            <section
              class="rounded-md border p-4"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
            >
              <div class="mb-3">
                <div
                  class="text-xs font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.72);"
                >
                  Map Stats
                </div>
                <div class="text-xs" style="color: rgba(255,255,255,0.45);">
                  All recorded maps — not affected by the batch selector above.
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <thead>
                    <tr
                      class="text-xs tracking-wide uppercase"
                      style="color: rgba(255,255,255,0.75);"
                    >
                      <th class="px-3 py-2">Map</th>
                      <th class="px-3 py-2">Played</th>
                      <th class="px-3 py-2">Win%</th>
                      <th class="px-3 py-2">ACS</th>
                      <th class="px-3 py-2">K/D</th>
                      <th class="px-3 py-2">ADR</th>
                      <th class="px-3 py-2">KAST</th>
                      <th class="px-3 py-2">HS%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each mapStats as entry (entry.key)}
                      <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                        <td class="px-3 py-2 font-medium" style="color: var(--text);">
                          {entry.key}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {entry.maps_played}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {#if entry.win_pct != null}
                            {fmt(entry.win_pct, 0)}%
                            <span
                              class="ml-1 text-xs"
                              style="color: rgba(255,255,255,0.4);"
                              title="Maps won–lost. Maps with no recorded result are excluded."
                            >
                              {entry.maps_won}–{entry.maps_decided - entry.maps_won}
                            </span>
                          {:else}
                            —
                          {/if}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.acs, 0)}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.kd, 2)}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.adr, 0)}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.kast_pct, 0)}%
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.hs_pct, 0)}%
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </section>
          {/if}

          {#if agentStats.length > 0}
            <section
              class="rounded-md border p-4"
              style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
            >
              <div class="mb-3">
                <div
                  class="text-xs font-semibold tracking-wide uppercase"
                  style="color: rgba(255,255,255,0.72);"
                >
                  Agent Stats
                </div>
                <div class="text-xs" style="color: rgba(255,255,255,0.45);">
                  All recorded maps — not affected by the batch selector above.
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-left text-sm">
                  <thead>
                    <tr
                      class="text-xs tracking-wide uppercase"
                      style="color: rgba(255,255,255,0.75);"
                    >
                      <th class="px-3 py-2">Agent</th>
                      <th class="px-3 py-2">Played</th>
                      <th class="px-3 py-2">Win%</th>
                      <th class="px-3 py-2">ACS</th>
                      <th class="px-3 py-2">K/D</th>
                      <th class="px-3 py-2">ADR</th>
                      <th class="px-3 py-2">KAST</th>
                      <th class="px-3 py-2">HS%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each agentStats as entry (entry.key)}
                      <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                        <td class="px-3 py-2" style="color: var(--text);">
                          <div class="flex items-center gap-2">
                            {#if agentIconUrl(entry.key)}
                              <img
                                src={agentIconUrl(entry.key) ?? ''}
                                alt={entry.key}
                                class="h-6 w-6 rounded-sm object-contain"
                                style="background: rgba(0,0,0,0.15);"
                              />
                            {/if}
                            <span class="font-medium">{entry.key}</span>
                          </div>
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {entry.maps_played}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {#if entry.win_pct != null}
                            {fmt(entry.win_pct, 0)}%
                            <span
                              class="ml-1 text-xs"
                              style="color: rgba(255,255,255,0.4);"
                              title="Maps won–lost. Maps with no recorded result are excluded."
                            >
                              {entry.maps_won}–{entry.maps_decided - entry.maps_won}
                            </span>
                          {:else}
                            —
                          {/if}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.acs, 0)}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.kd, 2)}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.adr, 0)}
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.kast_pct, 0)}%
                        </td>
                        <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                          {fmt(entry.hs_pct, 0)}%
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </section>
          {/if}
        </div>
      {/if}

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-3 flex items-center gap-2">
          <div
            class="text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Match History
          </div>
        </div>

        {#if matchHistory.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            No participation stats recorded yet.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs tracking-wide uppercase" style="color: rgba(255,255,255,0.75);">
                  <th class="px-3 py-2">Opponent</th>
                  <th class="px-3 py-2">Agent</th>
                  <th class="px-3 py-2">ACS</th>
                  <th class="px-3 py-2">K/D/A</th>
                  <th class="px-3 py-2">KAST</th>
                  <th class="px-3 py-2">HS%</th>
                  <th class="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {#each matchHistory as entry (entry.match.id)}
                  {@const match = entry.match}
                  {@const opp = entry.opponent}
                  {@const score = entry.score}
                  <tr class="border-t" style="border-color: rgba(255,255,255,0.10);">
                    <td class="px-3 py-2" style="color: var(--text);">
                      <a
                        href={resolve(`/matches/${match.id}`)}
                        class="underline"
                        style="color: var(--text);"
                      >
                        vs {teamName(opp)}
                      </a>
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {#if parseAgents(entry.agents).length === 0}
                        —
                      {:else}
                        <div class="agents-icons">
                          {#each parseAgents(entry.agents) as agent (agent)}
                            {@const url = agentIconUrl(agent)}
                            {#if url}
                              <img
                                src={url}
                                alt={agent}
                                title={agent}
                                class="h-7 w-7 rounded-sm object-contain"
                                style="background: rgba(0,0,0,0.15);"
                              />
                            {:else}
                              <span
                                class="inline-flex h-7 w-7 items-center justify-center rounded-sm border text-[10px] font-bold"
                                style="border-color: rgba(255,255,255,0.15); color: rgba(255,255,255,0.8);"
                                title={agent}
                              >
                                {agent.slice(0, 3).toUpperCase()}
                              </span>
                            {/if}
                          {/each}
                        </div>
                      {/if}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {fmt(entry.acs, 0)}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);">
                      {entry.kills ?? 0}/{entry.deaths ?? 0}/{entry.assists ?? 0}
                    </td>
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{fmt(entry.kast_pct, 0)}%</td
                    >
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{fmt(entry.hs_pct, 0)}%</td
                    >
                    <td class="px-3 py-2" style="color: rgba(255,255,255,0.78);"
                      >{score.us}-{score.them}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <CommentThread
        entityType="player"
        entityId={player.profile_id}
        comments={data.comments ?? []}
        viewerId={data.viewer?.profileId ?? null}
        isAdmin={data.viewer?.isAdmin ?? false}
      />
    </div>
  </div>
</PageContainer>

<style>
  .agents-icons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Team identity and contact chips on one line, wrapping when narrow. */
  .identity-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    margin-top: 0.5rem;
  }

  /* Short and centred so it separates without crowding the text above. */
  .identity-divider {
    width: 1px;
    height: 0.75rem;
    align-self: center;
    background: rgba(255, 255, 255, 0.12);
    margin: 0 0.375rem;
  }

  .contact-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.1875rem 0.5rem;
    border-radius: 0.3125rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.75rem;
    text-decoration: none;
  }

  .contact-chip-link:hover {
    border-color: rgba(120, 67, 145, 0.5);
    background: rgba(120, 67, 145, 0.12);
    color: #d8b4fe;
  }
</style>
