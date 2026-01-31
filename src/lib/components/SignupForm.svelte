<script lang="ts">
  import { Plus, X } from 'lucide-svelte'

  let riotId = $state('')
  let pronouns = $state('')
  let trackerLinks = $state<string[]>([''])
  let isSubmitting = $state(false)
  let submitMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null)

  const pronounOptions = [
    { value: '', label: 'Select pronouns...' },
    { value: 'he/him', label: 'He/Him' },
    { value: 'she/her', label: 'She/Her' },
    { value: 'they/them', label: 'They/Them' },
    { value: 'he/they', label: 'He/They' },
    { value: 'she/they', label: 'She/They' },
    { value: 'any', label: 'Any Pronouns' },
    { value: 'other', label: 'Other/Prefer not to say' },
  ]

  function addTrackerLink() {
    trackerLinks = [...trackerLinks, '']
  }

  function removeTrackerLink(index: number) {
    trackerLinks = trackerLinks.filter((_, i) => i !== index)
  }

  function updateTrackerLink(index: number, value: string) {
    trackerLinks = trackerLinks.map((link, i) => (i === index ? value : link))
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    isSubmitting = true
    submitMessage = null

    // Filter out empty tracker links
    const validTrackerLinks = trackerLinks.filter((link) => link.trim() !== '')

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          riotId,
          pronouns,
          trackerLinks: validTrackerLinks,
        }),
      })

      if (response.ok) {
        submitMessage = {
          type: 'success',
          text: 'Registration successful! Welcome to Throw City Rivals.',
        }
        // Reset form
        riotId = ''
        pronouns = ''
        trackerLinks = ['']
      } else {
        const data = await response.json()
        submitMessage = {
          type: 'error',
          text: data.message || 'Registration failed. Please try again.',
        }
      }
    } catch (error) {
      submitMessage = { type: 'error', text: 'An error occurred. Please try again.' }
    } finally {
      isSubmitting = false
    }
  }
</script>

<div class="signup-form-container">
  <form onsubmit={handleSubmit} class="space-y-5">
    <div>
      <label for="riotId" class="mb-1 block text-sm font-medium" style="color: var(--text);">
        Riot ID
      </label>
      <input
        type="text"
        id="riotId"
        bind:value={riotId}
        placeholder="Name#TAG"
        required
        class="w-full rounded-md border px-3 py-2 text-sm"
        style="background-color: rgba(0, 0, 0, 0.3); border-color: var(--border); color: var(--text);"
      />
    </div>

    <div>
      <label for="pronouns" class="mb-1 block text-sm font-medium" style="color: var(--text);">
        Preferred Pronouns
      </label>
      <select
        id="pronouns"
        bind:value={pronouns}
        required
        class="w-full rounded-md border px-3 py-2 text-sm"
        style="background-color: rgba(0, 0, 0, 0.3); border-color: var(--border); color: var(--text);"
      >
        {#each pronounOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>

    <div>
      <span class="mb-1 block text-sm font-medium" style="color: var(--text);">
        Tracker Profile Links
      </span>
      <div class="space-y-2" role="group" aria-label="Tracker profile links">
        {#each trackerLinks as link, index}
          <div class="flex gap-2">
            <input
              type="url"
              value={link}
              oninput={(e) => updateTrackerLink(index, e.currentTarget.value)}
              placeholder="https://tracker.gg/valorant/profile/..."
              class="flex-1 rounded-md border px-3 py-2 text-sm"
              style="background-color: rgba(0, 0, 0, 0.3); border-color: var(--border); color: var(--text);"
            />
            {#if trackerLinks.length > 1}
              <button
                type="button"
                onclick={() => removeTrackerLink(index)}
                class="rounded-md p-2 transition-opacity hover:opacity-80"
                style="background-color: rgba(255, 0, 0, 0.3); color: var(--text);"
                aria-label="Remove tracker link"
              >
                <X class="h-4 w-4" />
              </button>
            {/if}
          </div>
        {/each}
      </div>
      <button
        type="button"
        onclick={addTrackerLink}
        class="mt-2 flex items-center gap-1 text-sm hover:underline"
        style="color: var(--text);"
      >
        <Plus class="h-4 w-4" />
        Add another tracker link
      </button>
    </div>

    {#if submitMessage}
      <div
        class="rounded-md p-3 text-sm"
        style="background-color: {submitMessage.type === 'success'
          ? 'rgba(0, 255, 0, 0.15)'
          : 'rgba(255, 0, 0, 0.15)'}; color: var(--text);"
      >
        {submitMessage.text}
      </div>
    {/if}

    <button
      type="submit"
      disabled={isSubmitting}
      class="w-full rounded-md py-3 font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
      style="background-color: var(--accent); color: var(--text);"
    >
      {isSubmitting ? 'Submitting...' : 'Register for Season 4'}
    </button>
  </form>
</div>

<style>
  .signup-form-container {
    background-color: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 1.5rem;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.25);
  }

  input::placeholder,
  select option:first-child {
    color: rgba(255, 255, 255, 0.5);
  }

  select option {
    background-color: #1a1b25;
    color: white;
  }
</style>
