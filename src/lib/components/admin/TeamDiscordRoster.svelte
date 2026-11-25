<script lang="ts">
  /*
   * Publishes a team's roster to Discord on purpose, instead of on every edit.
   * Shows what changed since the last publish; mistakes undone before
   * publishing never appear. See $lib/server/discord/team-roster.ts.
   */
  interface Props {
    teamId: string
    /** Changes whenever the roster does, so the pending list refreshes. */
    rosterKey: string
  }

  let { teamId, rosterKey }: Props = $props()

  type Role = 'captain' | 'player' | 'substitute' | 'coach' | 'manager'
  type Change =
    | { type: 'added'; name: string; role: Role }
    | { type: 'removed'; name: string; role: Role }
    | { type: 'role'; name: string; from: Role; to: Role }
  type Embed = {
    title?: string
    description?: string
    fields?: Array<{ name: string; value: string }>
  }
  type Info = {
    announced: boolean
    seasonActive: boolean
    channels: { creation: boolean; updates: boolean }
    current: Array<{ name: string; role: Role }>
    pending: Change[]
    lastPublishedAt: string | null
    updateCount: number
    preview: { update: { embeds: Embed[] } | null; creation: { embeds: Embed[] } }
  }

  const ROLE: Record<Role, string> = {
    captain: 'Captain',
    player: 'Player',
    substitute: 'Sub',
    coach: 'Coach',
    manager: 'Manager',
  }

  let info = $state<Info | null>(null)
  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let message = $state<{ kind: 'good' | 'bad'; text: string } | null>(null)
  let confirmingCorrect = $state(false)

  async function load() {
    try {
      const res = await fetch(`/api/admin/teams/${teamId}/discord-roster`)
      if (!res.ok)
        throw new Error((await res.json().catch(() => null))?.message ?? 'Failed to load')
      info = await res.json()
      loadError = null
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load'
    }
  }

  $effect(() => {
    void rosterKey
    void teamId
    load()
  })

  async function run(action: 'publish' | 'correct') {
    busy = true
    message = null
    try {
      const res = await fetch(`/api/admin/teams/${teamId}/discord-roster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.message ?? 'Request failed')
      if (action === 'correct') {
        message = {
          kind: 'good',
          text:
            body.outcome === 'withdrawn'
              ? 'The last update undid itself, so its post was deleted.'
              : 'Last post corrected.',
        }
      } else if (body.kind === 'initial') {
        message = { kind: 'good', text: 'Team announced in #team-creation.' }
      } else {
        message = {
          kind: body.creationPosted ? 'good' : 'bad',
          text: body.creationPosted
            ? 'Posted to #team-updates and updated the team post.'
            : 'Posted to #team-updates, but the #team-creation post could not be edited.',
        }
      }
      await load()
    } catch (err) {
      message = { kind: 'bad', text: err instanceof Error ? err.message : 'Request failed' }
    } finally {
      busy = false
      confirmingCorrect = false
    }
  }

  function changeText(c: Change): string {
    if (c.type === 'added') return `+ ${c.name}${c.role === 'player' ? '' : ` (${ROLE[c.role]})`}`
    if (c.type === 'removed') return `− ${c.name}`
    return `↻ ${c.name}: ${ROLE[c.from]} → ${ROLE[c.to]}`
  }

  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''

  /** Discord markdown, flattened for the preview. */
  const plain = (text: string) =>
    text
      .replace(/<t:(\d+):\w>/g, (_, s) => new Date(Number(s) * 1000).toLocaleDateString())
      .replace(/\*\*/g, '')
      .replace(/\\([\\*_~`|>[\]])/g, '$1')
</script>

<div class="admin-bordered mt-3 p-2">
  <div
    class="mb-2 text-[11px] font-semibold tracking-wide uppercase"
    style="color: rgba(255,255,255,0.7);"
  >
    Discord Roster
  </div>

  {#if loadError}
    <p class="text-xs" style="color: var(--bad-text, #f87171);">{loadError}</p>
  {:else if !info}
    <p class="text-xs" style="color: rgba(255,255,255,0.5);">Loading…</p>
  {:else if !info.seasonActive}
    <p class="text-xs" style="color: rgba(255,255,255,0.55);">
      Only teams in the active season post to Discord.
    </p>
  {:else}
    {#if !info.channels.creation || (info.announced && !info.channels.updates)}
      <p class="mb-2 text-xs" style="color: var(--gold-text, #facc15);">
        {!info.channels.creation ? 'WEBHOOK_TEAM_CREATION' : 'WEBHOOK_TEAM_UPDATES'} is not set, so nothing
        can be published.
      </p>
    {/if}

    {#if !info.announced}
      <p class="text-xs" style="color: rgba(255,255,255,0.75);">
        Not announced yet. Finish the roster, then announce the team in #team-creation. Edits before
        that post nothing.
      </p>
      <div class="mt-2 flex justify-end">
        <button
          type="button"
          class="admin-btn admin-btn-sm admin-btn-go"
          disabled={busy || info.current.length === 0 || !info.channels.creation}
          onclick={() => run('publish')}
        >
          {busy ? 'Posting…' : `Announce team (${info.current.length} on roster)`}
        </button>
      </div>
    {:else if info.pending.length === 0}
      <p class="text-xs" style="color: var(--good-text, #4ade80);">
        Discord is up to date · last published {when(info.lastPublishedAt)}
      </p>
    {:else}
      <p class="mb-1 text-xs" style="color: rgba(255,255,255,0.75);">
        Unpublished changes since {when(info.lastPublishedAt)}:
      </p>
      <ul class="mb-2 space-y-0.5 text-xs" style="color: var(--text);">
        {#each info.pending as change, i (i)}
          <li class="font-mono">{changeText(change)}</li>
        {/each}
      </ul>
      <div class="flex flex-wrap justify-end gap-2">
        {#if confirmingCorrect}
          <span class="self-center text-[11px]" style="color: rgba(255,255,255,0.65);">
            Fold these into the last post instead of posting new?
          </span>
          <button
            type="button"
            class="admin-btn admin-btn-sm"
            disabled={busy}
            onclick={() => (confirmingCorrect = false)}
          >
            Cancel
          </button>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-warn"
            disabled={busy}
            onclick={() => run('correct')}
          >
            {busy ? 'Correcting…' : 'Yes, correct last post'}
          </button>
        {:else}
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-warn"
            disabled={busy || !info.channels.creation}
            title="Edit the last post so it matches the roster, without a new post"
            onclick={() => (confirmingCorrect = true)}
          >
            Correct last post
          </button>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-go"
            disabled={busy || !info.channels.creation || !info.channels.updates}
            onclick={() => run('publish')}
          >
            {busy ? 'Posting…' : 'Publish to #team-updates'}
          </button>
        {/if}
      </div>
    {/if}

    {#if message}
      <p
        class="mt-2 text-xs"
        style="color: {message.kind === 'good'
          ? 'var(--good-text, #4ade80)'
          : 'var(--bad-text, #f87171)'};"
      >
        {message.text}
      </p>
    {/if}

    {#if !info.announced || info.pending.length > 0}
      <details class="mt-2 text-xs" style="color: rgba(255,255,255,0.7);">
        <summary class="cursor-pointer select-none">Preview the posts</summary>
        {#each [info.preview.update?.embeds[0], info.preview.creation.embeds[0]] as embed, i (i)}
          {#if embed}
            <div class="mt-2 rounded border-l-4 border-white/30 bg-white/5 p-2">
              <div class="mb-1 text-[10px] uppercase opacity-60">
                {i === 0
                  ? '#team-updates (new post)'
                  : info.announced
                    ? '#team-creation (edited)'
                    : '#team-creation (new post)'}
              </div>
              <div class="font-semibold" style="color: var(--text);">{embed.title}</div>
              {#if embed.description}
                <div class="whitespace-pre-line">{plain(embed.description)}</div>
              {/if}
              {#each embed.fields ?? [] as field (field.name)}
                <div class="mt-1">
                  <div class="font-semibold">{field.name}</div>
                  <div class="whitespace-pre-line opacity-80">{plain(field.value)}</div>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </details>
    {/if}
  {/if}
</div>
