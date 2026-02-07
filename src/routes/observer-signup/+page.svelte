<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { Video, LogIn } from 'lucide-svelte'

  const user = $derived($page.data.user)

  let hasPreviousExperience = $state('')
  let canStreamQuality = $state('')
  let willingToUseOverlay = $state('')
  let additionalInfo = $state('')
  let isSubmitting = $state(false)
  let submitMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null)
  let showConfirmation = $state(false)

  function handleLogin() {
    window.location.href = '/auth/login'
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

    if (!user) {
      submitMessage = { type: 'error', text: 'You must be logged in to submit this form.' }
      return
    }

    isSubmitting = true
    submitMessage = null

    try {
      const response = await fetch('/api/observer-signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hasPreviousExperience: hasPreviousExperience === 'yes',
          canStreamQuality: canStreamQuality === 'yes',
          willingToUseOverlay: willingToUseOverlay === 'yes',
          additionalInfo,
        }),
      })

      if (response.ok) {
        submitMessage = {
          type: 'success',
          text: 'Thank you for signing up as an observer! We will be in touch soon.',
        }
        // Reset form
        hasPreviousExperience = ''
        canStreamQuality = ''
        willingToUseOverlay = ''
        additionalInfo = ''
      } else {
        const data = await response.json()
        submitMessage = {
          type: 'error',
          text: data.message || 'Submission failed. Please try again.',
        }
      }
    } catch (error) {
      submitMessage = { type: 'error', text: 'An error occurred. Please try again.' }
    } finally {
      isSubmitting = false
    }
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-2xl">
      <div class="mb-8 flex flex-col items-center">
        <Video size={48} class="mb-4" style="color: var(--text);" />
        <h1 class="responsive-title mb-2 text-center">Observer Sign Up</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Sign up to be an observer for Throw City Rivals Season 4
        </p>
      </div>

      {#if !user}
        <div class="info-card info-card-surface flex flex-col items-center gap-4 p-8 text-center">
          <LogIn size={32} style="color: rgba(255,255,255,0.75);" />
          <p class="text-lg" style="color: var(--text);">
            You must be logged in to sign up as an observer.
          </p>
          <button
            type="button"
            class="flex items-center gap-2 rounded-md px-6 py-3 text-base font-bold transition-opacity hover:opacity-90"
            style="background: var(--accent); color: var(--text);"
            onclick={handleLogin}
          >
            <LogIn size={18} />
            <span>Login to Continue</span>
          </button>
        </div>
      {:else}
        <div class="relative">
          {#if showConfirmation}
            <div
              class="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/80"
            >
              <div
                class="w-full max-w-sm rounded-lg border p-6 text-center"
                style="background: var(--secondary-background); border-color: rgba(255,255,255,0.2);"
              >
                <h3 class="mb-3 text-xl font-bold" style="color: var(--title);">
                  Confirm Application
                </h3>
                <p class="mb-5 text-sm" style="color: var(--text);">
                  Are you sure you want to submit your observer application?
                </p>
                <div class="flex justify-center gap-3">
                  <button
                    type="button"
                    class="rounded-md border px-4 py-2"
                    style="border-color: rgba(255,255,255,0.2); color: var(--text);"
                    onclick={cancelSubmit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rounded-md px-4 py-2 font-semibold"
                    style="background: var(--accent); color: var(--text);"
                    onclick={confirmSubmit}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          {/if}
          <form
            onsubmit={requestSubmit}
            class="info-card info-card-surface flex flex-col gap-6 p-6"
          >
            <fieldset class="flex flex-col gap-2">
              <legend class="text-base font-semibold" style="color: var(--text);">
                Do you have previous experience observing?
              </legend>
              <div class="flex gap-6 pt-1">
                <label class="flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="radio"
                    name="experience"
                    value="yes"
                    bind:group={hasPreviousExperience}
                    required
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>Yes</span>
                </label>
                <label class="flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="radio"
                    name="experience"
                    value="no"
                    bind:group={hasPreviousExperience}
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>No</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="flex flex-col gap-2">
              <legend class="text-base font-semibold" style="color: var(--text);">
                Can you run OBS & stream at a good quality (1080p 60fps)?
              </legend>
              <div class="flex gap-6 pt-1">
                <label class="flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="radio"
                    name="quality"
                    value="yes"
                    bind:group={canStreamQuality}
                    required
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>Yes</span>
                </label>
                <label class="flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="radio"
                    name="quality"
                    value="no"
                    bind:group={canStreamQuality}
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>No</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="flex flex-col gap-2">
              <legend class="text-base font-semibold" style="color: var(--text);">
                Are you willing to download and use a standardized Rivals OBS Overlay?
              </legend>
              <div class="flex gap-6 pt-1">
                <label class="flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="radio"
                    name="overlay"
                    value="yes"
                    bind:group={willingToUseOverlay}
                    required
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>Yes</span>
                </label>
                <label class="flex items-center gap-2 text-sm" style="color: var(--text);">
                  <input
                    type="radio"
                    name="overlay"
                    value="no"
                    bind:group={willingToUseOverlay}
                    class="h-4 w-4"
                    style="accent-color: var(--accent);"
                  />
                  <span>No</span>
                </label>
              </div>
            </fieldset>

            <div class="flex flex-col gap-2">
              <label
                for="additionalInfo"
                class="text-base font-semibold"
                style="color: var(--text);"
              >
                How often could you observe & any other information you'd think it's important for
                me to know.
              </label>
              <textarea
                id="additionalInfo"
                bind:value={additionalInfo}
                placeholder="e.g., I can observe 2-3 times per week, I have experience with..."
                rows="4"
                class="rounded-md border px-3 py-2"
                style="border-color: rgba(255,255,255,0.15); background: rgba(0,0,0,0.3); color: var(--text);"
                required
              ></textarea>
            </div>

            {#if submitMessage}
              <div
                class="rounded-md p-3 text-center"
                style={submitMessage.type === 'success'
                  ? 'background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid rgba(74, 222, 128, 0.4);'
                  : 'background: rgba(248, 113, 113, 0.2); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.4);'}
              >
                {submitMessage.text}
              </div>
            {/if}

            <button
              type="submit"
              class="rounded-md px-4 py-3 text-base font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              style="background: var(--accent); color: var(--text);"
              disabled={isSubmitting}
            >
              {#if isSubmitting}
                Submitting...
              {:else}
                Submit Application
              {/if}
            </button>
          </form>
        </div>
      {/if}
    </div>
  </div>
</PageContainer>
