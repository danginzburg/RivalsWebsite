<script lang="ts">
  import { onMount } from 'svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import ClipPlayer from '$lib/components/ClipPlayer.svelte'
  import { adminJsonRequest } from '$lib/admin/api'
  import { parseClipUrl } from '$lib/media/clip-embed'

  interface Props {
    teamOptions: Array<{ value: string; label: string }>
    playerOptions: Array<{ value: string; label: string }>
    seasonOptions: Array<{ value: string; label: string }>
    onCreated: () => void
  }

  let { teamOptions, playerOptions, seasonOptions, onCreated }: Props = $props()

  type TeamRef = { id: string; name: string; tag: string | null }
  type MatchRow = {
    id: string
    season_id: string | null
    scheduled_at: string | null
    team_a: TeamRef | TeamRef[] | null
    team_b: TeamRef | TeamRef[] | null
    vod_url: string | null
  }

  const blank = () => ({
    title: '',
    mediaUrl: '',
    matchId: '',
    profileId: '',
    playerName: '',
    teamId: '',
    description: '',
  })

  let form = $state(blank())
  let matches = $state<MatchRow[]>([])
  let saving = $state(false)
  let message = $state<string | null>(null)

  const one = (t: TeamRef | TeamRef[] | null) => (Array.isArray(t) ? (t[0] ?? null) : t)
  const short = (t: TeamRef | null) => t?.tag ?? t?.name ?? 'TBD'

  const seasonLabel = $derived(new Map(seasonOptions.map((o) => [o.value, o.label])))

  /** Newest first, grouped under their season. */
  const matchOptions = $derived(
    [...matches]
      .sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? ''))
      .map((m) => ({
        value: m.id,
        label: `${short(one(m.team_a))} vs ${short(one(m.team_b))}${
          m.scheduled_at
            ? ` · ${new Date(m.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
            : ''
        }`,
        group: (m.season_id && seasonLabel.get(m.season_id)) || 'No season',
      }))
  )

  const selectedMatch = $derived(matches.find((m) => m.id === form.matchId) ?? null)

  /** With a match picked, the team is one of the two that played. */
  const teamChoices = $derived.by(() => {
    if (!selectedMatch) return [{ value: '', label: 'No team' }, ...teamOptions]
    const teams = [one(selectedMatch.team_a), one(selectedMatch.team_b)].filter(
      (t): t is TeamRef => t !== null
    )
    return [{ value: '', label: 'No team' }, ...teams.map((t) => ({ value: t.id, label: t.name }))]
  })

  const playerChoices = $derived([{ value: '', label: 'No player' }, ...playerOptions])
  const embeddable = $derived(parseClipUrl(form.mediaUrl) !== null)

  function pickMatch(id: string) {
    form.matchId = id
    const match = matches.find((m) => m.id === id)
    const teamIds = [one(match?.team_a ?? null)?.id, one(match?.team_b ?? null)?.id]
    if (form.teamId && !teamIds.includes(form.teamId)) form.teamId = ''
  }

  async function save() {
    if (!form.title.trim()) {
      message = 'Give the moment a title.'
      return
    }
    saving = true
    message = null
    try {
      await adminJsonRequest('/api/admin/hall-of-fame', {
        method: 'POST',
        body: {
          entryType: 'moment',
          ...form,
          seasonId: selectedMatch?.season_id ?? '',
          isPublished: true,
          sortOrder: 0,
        },
        fallbackMessage: 'Failed to add the moment',
      })
      form = blank()
      message = 'Moment added to the Hall of Fame.'
      onCreated()
    } catch (err) {
      message = err instanceof Error ? err.message : 'Failed to add the moment'
    } finally {
      saving = false
    }
  }

  onMount(async () => {
    try {
      const result = await adminJsonRequest<{ matches?: MatchRow[] }>('/api/admin/matches', {
        fallbackMessage: 'Failed to load matches',
      })
      matches = result.matches ?? []
    } catch {
      // The form still works without a match.
    }
  })
</script>

<section class="admin-bordered p-3">
  <div class="text-sm font-semibold tracking-wide uppercase" style="color: rgba(255,255,255,0.8);">
    Add Moment
  </div>
  <p class="mt-1 text-xs" style="color: rgba(255,255,255,0.6);">
    YouTube, Twitch and Streamable links play right on the Hall of Fame; anything else shows as a
    link. Pick the match it happened in and the card links back to it.
  </p>

  <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
    <div class="grid grid-cols-1 content-start gap-2">
      <input
        class="admin-input"
        placeholder="Title (e.g. 1v4 clutch on match point)"
        value={form.title}
        oninput={(e) => (form.title = e.currentTarget.value)}
      />
      <input
        class="admin-input"
        placeholder="Clip link (YouTube, Twitch, Streamable...)"
        value={form.mediaUrl}
        oninput={(e) => (form.mediaUrl = e.currentTarget.value)}
      />
      <div>
        <CustomSelect
          options={[{ value: '', label: 'No match' }, ...matchOptions]}
          value={form.matchId}
          compact={true}
          placeholder="Match (optional)"
          onSelect={pickMatch}
        />
      </div>
      {#if selectedMatch?.vod_url && !form.mediaUrl}
        <button
          type="button"
          class="admin-btn admin-btn-sm admin-btn-neutral justify-self-start"
          onclick={() => (form.mediaUrl = selectedMatch?.vod_url ?? '')}
        >
          Use this match's VOD
        </button>
      {/if}
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <CustomSelect
            options={playerChoices}
            value={form.profileId}
            compact={true}
            placeholder="Player (optional)"
            onSelect={(value) => (form.profileId = value)}
          />
        </div>
        <input
          class="admin-input"
          placeholder="Or type a name"
          value={form.playerName}
          oninput={(e) => (form.playerName = e.currentTarget.value)}
        />
        <div>
          <CustomSelect
            options={teamChoices}
            value={form.teamId}
            compact={true}
            placeholder="Team (optional)"
            onSelect={(value) => (form.teamId = value)}
          />
        </div>
      </div>
      <textarea
        rows="2"
        class="admin-input leading-5"
        placeholder="What happened (optional)"
        value={form.description}
        oninput={(e) => (form.description = e.currentTarget.value)}
      ></textarea>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs" style="color: rgba(255,255,255,0.7);">{message ?? ''}</span>
        <button
          type="button"
          class="admin-btn admin-btn-go text-sm"
          onclick={save}
          disabled={saving}
        >
          {saving ? 'Adding...' : 'Add moment'}
        </button>
      </div>
    </div>

    <div>
      <div class="text-xs font-semibold" style="color: rgba(255,255,255,0.6);">Preview</div>
      {#if form.mediaUrl.trim()}
        {#key form.mediaUrl}
          <ClipPlayer url={form.mediaUrl.trim()} title={form.title || 'Clip preview'} />
        {/key}
        {#if !embeddable}
          <p class="mt-1 text-xs" style="color: #fcd34d;">
            This link can't play inline, so it will show as a "Watch clip" link.
          </p>
        {/if}
      {:else}
        <p class="mt-2 text-xs" style="color: rgba(255,255,255,0.5);">
          Paste a clip link to see how it will look.
        </p>
      {/if}
    </div>
  </div>
</section>
