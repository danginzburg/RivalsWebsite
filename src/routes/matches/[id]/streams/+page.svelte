<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { ArrowLeft, RadioTower } from 'lucide-svelte'

  let { data } = $props()

  const match = $derived(data.match as any)
  let streams = $state<any[]>([])

  $effect(() => {
    streams = data.streams ?? []
  })

  let platform = $state('twitch')
  let streamUrl = $state('')
  let isPrimary = $state(true)

  let isSubmitting = $state(false)
  let errorMessage = $state<string | null>(null)

  const platformOptions = [
    { label: 'Twitch', value: 'twitch' },
    { label: 'YouTube', value: 'youtube' },
    { label: 'Kick', value: 'kick' },
    { label: 'Other', value: 'other' },
  ]

  function teamName(value: unknown) {
    if (!value) return 'Team'
    if (Array.isArray(value)) return (value[0] as { name?: string } | undefined)?.name ?? 'Team'
    return (value as { name?: string }).name ?? 'Team'
  }

  async function refresh() {
    const res = await fetch(`/api/matches/${match.id}/streams`)
    const body = await res.json()
    streams = body.streams ?? []
  }

  async function addStream() {
    errorMessage = null
    isSubmitting = true
    try {
      const res = await fetch(`/api/matches/${match.id}/streams`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, streamUrl, isPrimary }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.message ?? 'Failed to add stream')
      }

      streamUrl = ''
      isPrimary = false
      await refresh()
    } catch (err: any) {
      errorMessage = err?.message ?? 'Something went wrong'
    } finally {
      isSubmitting = false
    }
  }

  async function setPrimary(streamId: string) {
    errorMessage = null
    const res = await fetch(`/api/matches/${match.id}/streams`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamId, isPrimary: true }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      errorMessage = body?.message ?? 'Failed to update stream'
      return
    }
    await refresh()
  }

  async function updateStatus(streamId: string, status: string) {
    errorMessage = null
    const res = await fetch(`/api/matches/${match.id}/streams`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamId, status }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      errorMessage = body?.message ?? 'Failed to update stream'
      return
    }
    await refresh()
  }

  async function removeStream(streamId: string) {
    errorMessage = null
    const res = await fetch(`/api/matches/${match.id}/streams`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamId }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      errorMessage = body?.message ?? 'Failed to remove stream'
      return
    }
    await refresh()
  }

  const statusOptions = [
    { label: 'Scheduled', value: 'scheduled' },
    { label: 'Live', value: 'live' },
    { label: 'Ended', value: 'ended' },
  ]
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-4xl">
      <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <RadioTower size={32} style="color: var(--text);" />
          <div>
            <h1 class="responsive-title">Manage Streams</h1>
            <p class="text-sm" style="color: rgba(255,255,255,0.72);">
              {teamName(match.team_a)} vs {teamName(match.team_b)}
            </p>
          </div>
        </div>
        <a
          href={`/matches/${match.id}`}
          class="inline-flex items-center gap-2 rounded px-2 py-1 text-xs"
          style="background: rgba(255,255,255,0.10); color: var(--text);"
        >
          <ArrowLeft size={14} />
          Back
        </a>
      </div>

      {#if errorMessage}
        <div
          class="mb-4 rounded-md border p-3 text-sm"
          style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
        >
          {errorMessage}
        </div>
      {/if}

      <section
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div
          class="mb-3 text-xs font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.72);"
        >
          Add Stream
        </div>

        <div class="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div class="md:col-span-1">
            <CustomSelect options={platformOptions} bind:value={platform} />
          </div>
          <div class="md:col-span-2">
            <input
              type="url"
              bind:value={streamUrl}
              placeholder="https://..."
              class="w-full rounded-md border px-2 py-2 text-sm"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            />
          </div>
          <div class="flex items-center justify-between gap-2 md:col-span-1">
            <label class="flex items-center gap-2 text-xs" style="color: rgba(255,255,255,0.72);">
              <input type="checkbox" bind:checked={isPrimary} />
              Primary
            </label>
            <button
              type="button"
              class="rounded px-2 py-1 text-xs font-semibold"
              style="background: rgba(74,222,128,0.2); color: #4ade80;"
              onclick={addStream}
              disabled={isSubmitting || !streamUrl.trim()}
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      </section>

      <section
        class="mt-4 rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div
          class="mb-3 text-xs font-semibold tracking-wide uppercase"
          style="color: rgba(255,255,255,0.72);"
        >
          Current Streams
        </div>

        {#if streams.length === 0}
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">No streams yet.</p>
        {:else}
          <div class="flex flex-col gap-2">
            {#each streams as stream}
              <div
                class="rounded-md border p-3"
                style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.18);"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="text-sm" style="color: var(--text);">
                    <strong>{stream.platform}</strong>
                    {#if stream.is_primary}
                      <span
                        class="ml-2 rounded-full px-2 py-0.5 text-xs"
                        style="background: rgba(59,130,246,0.2); color: #93c5fd;">Primary</span
                      >
                    {/if}
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.85);"
                      onclick={() => setPrimary(stream.id)}
                      disabled={stream.is_primary}
                    >
                      Set Primary
                    </button>

                    <div class="min-w-[160px]">
                      <CustomSelect
                        options={statusOptions}
                        value={stream.status}
                        onSelect={(v: string) => updateStatus(stream.id, v)}
                        compact={true}
                      />
                    </div>

                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs"
                      style="background: rgba(248,113,113,0.2); color: #f87171;"
                      onclick={() => removeStream(stream.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <a
                  class="mt-2 block text-xs break-all"
                  style="color: #93c5fd;"
                  href={stream.stream_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {stream.stream_url}
                </a>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  </div>
</PageContainer>
