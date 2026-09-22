<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { adminJsonRequest } from '$lib/admin/api'
  import { resolve } from '$app/paths'
  import { ArrowLeft, Link2, Loader2 } from 'lucide-svelte'
  import type { PageProps } from './$types'

  type Identity = {
    puuid: string
    latest_name: string | null
    latest_tag: string | null
    last_seen_at: string | null
    first_seen_at: string | null
    maps_seen: number
  }

  let { data }: PageProps = $props()

  // Seeded via a function and a derived so the props reference is not read
  // bare in an initializer (Svelte's state_referenced_locally warning).
  const getInitialIdentities = () => data.identities
  let identities = $state<Identity[]>(getInitialIdentities())
  const profiles = $derived(data.profiles)

  let search = $state('')
  let selection = $state<Record<string, string>>({})
  let linkingPuuid = $state<string | null>(null)
  let errorMessage = $state<string | null>(null)
  let successMessage = $state<string | null>(null)

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase()
    if (!q) return identities
    return identities.filter((i) =>
      `${i.latest_name ?? ''}#${i.latest_tag ?? ''} ${i.puuid}`.toLowerCase().includes(q)
    )
  })

  function riotId(identity: Identity): string {
    const name = identity.latest_name?.trim() || '(unknown name)'
    return identity.latest_tag ? `${name}#${identity.latest_tag}` : name
  }

  function formatDate(value: string | null): string {
    if (!value) return '—'
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : '—'
  }

  async function link(identity: Identity) {
    const profileId = selection[identity.puuid]
    if (!profileId) {
      errorMessage = `Pick a player for ${riotId(identity)} first.`
      return
    }

    linkingPuuid = identity.puuid
    errorMessage = null
    successMessage = null
    try {
      const result = await adminJsonRequest<{
        relink: { matchMapRowsLinked: number; matchesRebuilt: number } | null
      }>('/api/admin/riot-identities', {
        method: 'POST',
        body: { puuid: identity.puuid, profileId },
        fallbackMessage: 'Failed to link identity',
      })

      const label = profiles.find((p) => p.id === profileId)?.label ?? 'player'
      const linked = result.relink?.matchMapRowsLinked ?? 0
      successMessage =
        `Linked ${riotId(identity)} to ${label}` +
        (linked > 0 ? ` — pooled in ${linked} stat row${linked === 1 ? '' : 's'}.` : '.')

      // Drop the now-linked identity from the queue.
      identities = identities.filter((i) => i.puuid !== identity.puuid)
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to link identity'
    } finally {
      linkingPuuid = null
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center py-6 sm:py-8">
    <div class="w-full max-w-5xl space-y-5">
      <header class="admin-import-head">
        <div class="min-w-0">
          <h1 class="admin-import-title">Player Identities</h1>
          <p class="admin-hint mt-1">
            Every Riot PUUID seen in an imported match, tracked behind the scenes regardless of name
            changes. These are the ones not yet tied to a player — link each once and all of its
            past and future stats follow the PUUID through any rename.
          </p>
        </div>
        <a href={resolve('/admin')} class="admin-back-link">
          <ArrowLeft size={14} /> Admin
        </a>
      </header>

      {#if errorMessage}
        <div class="admin-alert admin-alert-error">{errorMessage}</div>
      {/if}
      {#if successMessage}
        <div class="admin-note">{successMessage}</div>
      {/if}

      <section class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div class="admin-stat">
          <div class="admin-stat-label">Unlinked identities</div>
          <div class="admin-stat-value">{identities.length}</div>
        </div>
        <div class="admin-stat">
          <div class="admin-stat-label">Registered players</div>
          <div class="admin-stat-value">{profiles.length}</div>
        </div>
      </section>

      <section class="admin-card admin-card-pad">
        <div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="min-w-0">
            <div class="admin-section-title">Review queue</div>
            <div class="admin-hint mt-1">Ranked by how many maps each identity has played.</div>
          </div>
          <label class="block w-full sm:max-w-xs">
            <div class="admin-field-label">Filter</div>
            <input
              type="search"
              bind:value={search}
              placeholder="Name or PUUID…"
              class="admin-input"
            />
          </label>
        </div>

        {#if filtered.length === 0}
          <div class="admin-note">
            {identities.length === 0
              ? 'No unlinked identities. Every PUUID seen so far is tied to a player.'
              : 'No identities match that filter.'}
          </div>
        {:else}
          <div class="table-scroll">
            <table class="min-w-full text-left text-sm">
              <thead>
                <tr class="text-xs uppercase" style="color: rgba(255, 255, 255, 0.75);">
                  <th class="px-3 py-2">Latest name</th>
                  <th class="px-3 py-2 text-right">Maps</th>
                  <th class="px-3 py-2">Last seen</th>
                  <th class="px-3 py-2">Link to player</th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {#each filtered as identity (identity.puuid)}
                  <tr class="admin-divide border-t">
                    <td class="px-3 py-2">
                      <div class="font-semibold" style="color: var(--text);">
                        {riotId(identity)}
                      </div>
                      <div class="font-mono text-[11px]" style="color: rgba(255, 255, 255, 0.4);">
                        {identity.puuid}
                      </div>
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums">{identity.maps_seen}</td>
                    <td class="px-3 py-2" style="color: rgba(255, 255, 255, 0.72);">
                      {formatDate(identity.last_seen_at)}
                    </td>
                    <td class="px-3 py-2">
                      <select bind:value={selection[identity.puuid]} class="admin-input">
                        <option value="" disabled selected>Select player…</option>
                        {#each profiles as profile (profile.id)}
                          <option value={profile.id}>{profile.label}</option>
                        {/each}
                      </select>
                    </td>
                    <td class="px-3 py-2 text-right">
                      <button
                        type="button"
                        class="admin-btn admin-btn-go admin-btn-sm"
                        onclick={() => link(identity)}
                        disabled={linkingPuuid === identity.puuid || !selection[identity.puuid]}
                      >
                        {#if linkingPuuid === identity.puuid}
                          <span class="inline-flex items-center gap-1.5">
                            <Loader2 size={14} class="animate-spin" /> Linking…
                          </span>
                        {:else}
                          <span class="inline-flex items-center gap-1.5">
                            <Link2 size={14} /> Link
                          </span>
                        {/if}
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
