<script lang="ts">
  import { Plus, X } from 'lucide-svelte'
  import CustomSelect from './CustomSelect.svelte'

  let {
    existingRegistration = null,
  }: {
    existingRegistration?: {
      id: number
      riot_id: string
      pronouns: string
      tracker_links: string[] | null
    } | null
  } = $props()

  const initialRiotId = () => existingRegistration?.riot_id ?? ''
  const initialPronouns = () => existingRegistration?.pronouns ?? ''
  const initialTrackerLinks = () =>
    existingRegistration?.tracker_links && existingRegistration.tracker_links.length > 0
      ? existingRegistration.tracker_links
      : ['']

  let riotId = $state(initialRiotId())
  let pronouns = $state(initialPronouns())
  let trackerLinks = $state<string[]>(initialTrackerLinks())
  let isSubmitting = $state(false)
  let submitMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null)
  let showConfirmation = $state(false)

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

  function requestSubmit(e: SubmitEvent) {
    e.preventDefault()
    showConfirmation = true
  }

  function cancelSubmit() {
    showConfirmation = false
  }

  async function confirmSubmit() {
    showConfirmation = false
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
          text: existingRegistration
            ? 'Registration updated successfully.'
            : 'Registration successful! Welcome to Throw City Rivals.',
        }
        if (!existingRegistration) {
          riotId = ''
          pronouns = ''
          trackerLinks = ['']
        }
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
  {#if showConfirmation}
    <div class="confirmation-overlay">
      <div class="confirmation-modal">
        <h3>Confirm Registration</h3>
        <p>Are you sure you want to submit your registration?</p>
        <div class="confirmation-buttons">
          <button type="button" class="cancel-btn" onclick={cancelSubmit}>Cancel</button>
          <button type="button" class="confirm-btn" onclick={confirmSubmit}>Confirm</button>
        </div>
      </div>
    </div>
  {/if}
  <form onsubmit={requestSubmit} class="space-y-5">
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
      <CustomSelect
        id="pronouns"
        options={pronounOptions}
        bind:value={pronouns}
        placeholder="Select pronouns..."
        required
      />
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
      {isSubmitting
        ? 'Submitting...'
        : existingRegistration
          ? 'Update Registration'
          : 'Register for Season 4'}
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
    position: relative;
  }

  input::placeholder {
    color: rgba(255, 255, 255, 0.5);
  }

  .confirmation-overlay {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    z-index: 10;
  }

  .confirmation-modal {
    background-color: var(--secondary-background);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 0.5rem;
    padding: 1.5rem;
    text-align: center;
    max-width: 300px;
  }

  .confirmation-modal h3 {
    color: var(--title);
    font-size: 1.25rem;
    font-weight: bold;
    margin-bottom: 0.75rem;
  }

  .confirmation-modal p {
    color: var(--text);
    font-size: 0.95rem;
    margin-bottom: 1.25rem;
  }

  .confirmation-buttons {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
  }

  .cancel-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background-color: transparent;
    color: var(--text);
    cursor: pointer;
    font-weight: 500;
    transition: background-color 0.2s ease;
  }

  .cancel-btn:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }

  .confirm-btn {
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    border: none;
    background-color: var(--accent);
    color: var(--text);
    cursor: pointer;
    font-weight: 500;
    transition: opacity 0.2s ease;
  }

  .confirm-btn:hover {
    opacity: 0.9;
  }
</style>
