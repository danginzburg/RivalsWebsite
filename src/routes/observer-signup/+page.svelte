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

  function handleLogin() {
    window.location.href = '/auth/login'
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault()

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
  <div class="observer-page-wrapper">
    <div class="observer-container">
      <div class="header-section">
        <Video size={48} class="header-icon" />
        <h1 class="responsive-title mb-2 text-center">Observer Sign Up</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Sign up to be an observer for Throw City Rivals Season 4
        </p>
      </div>

      {#if !user}
        <div class="login-prompt info-card info-card-surface">
          <LogIn size={32} class="login-icon" />
          <p>You must be logged in to sign up as an observer.</p>
          <button type="button" class="login-button" onclick={handleLogin}>
            <LogIn size={18} />
            <span>Login to Continue</span>
          </button>
        </div>
      {:else}
        <form onsubmit={handleSubmit} class="observer-form info-card info-card-surface">
          <div class="question-group">
            <label class="question-label"> Do you have previous experience observing? </label>
            <div class="radio-group">
              <label class="radio-option">
                <input
                  type="radio"
                  name="experience"
                  value="yes"
                  bind:group={hasPreviousExperience}
                  required
                />
                <span>Yes</span>
              </label>
              <label class="radio-option">
                <input
                  type="radio"
                  name="experience"
                  value="no"
                  bind:group={hasPreviousExperience}
                />
                <span>No</span>
              </label>
            </div>
          </div>

          <div class="question-group">
            <label class="question-label">
              Can you run OBS & stream at a good quality (1080p 60fps)?
            </label>
            <div class="radio-group">
              <label class="radio-option">
                <input
                  type="radio"
                  name="quality"
                  value="yes"
                  bind:group={canStreamQuality}
                  required
                />
                <span>Yes</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="quality" value="no" bind:group={canStreamQuality} />
                <span>No</span>
              </label>
            </div>
          </div>

          <div class="question-group">
            <label class="question-label">
              Are you willing to download and use a standardized Rivals OBS Overlay?
            </label>
            <div class="radio-group">
              <label class="radio-option">
                <input
                  type="radio"
                  name="overlay"
                  value="yes"
                  bind:group={willingToUseOverlay}
                  required
                />
                <span>Yes</span>
              </label>
              <label class="radio-option">
                <input type="radio" name="overlay" value="no" bind:group={willingToUseOverlay} />
                <span>No</span>
              </label>
            </div>
          </div>

          <div class="question-group">
            <label for="additionalInfo" class="question-label">
              How often could you observe & any other information you'd think it's important for me
              to know.
            </label>
            <textarea
              id="additionalInfo"
              bind:value={additionalInfo}
              placeholder="e.g., I can observe 2-3 times per week, I have experience with..."
              rows="4"
              class="text-input"
              required
            ></textarea>
          </div>

          {#if submitMessage}
            <div
              class="submit-message"
              class:success={submitMessage.type === 'success'}
              class:error={submitMessage.type === 'error'}
            >
              {submitMessage.text}
            </div>
          {/if}

          <button type="submit" class="submit-button" disabled={isSubmitting}>
            {#if isSubmitting}
              Submitting...
            {:else}
              Submit Application
            {/if}
          </button>
        </form>
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .observer-page-wrapper {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 2rem 1rem;
    min-height: 60vh;
  }

  .observer-container {
    width: 100%;
    max-width: 600px;
  }

  .header-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 2rem;
  }

  .header-section :global(.header-icon) {
    color: var(--text);
    margin-bottom: 1rem;
    filter: drop-shadow(0 3px 8px var(--accent));
  }

  .login-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
    text-align: center;
    color: var(--text);
  }

  .login-prompt :global(.login-icon) {
    color: var(--text);
    opacity: 0.7;
  }

  .login-prompt p {
    font-size: 1.1rem;
  }

  .login-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 0.5rem;
    border: none;
    background-color: var(--accent);
    color: var(--text);
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      transform 0.2s ease;
  }

  .login-button:hover {
    background-color: var(--hover);
    transform: translateY(-1px);
  }

  .observer-form {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.5rem;
  }

  .question-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .question-label {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
  }

  .question-hint {
    font-size: 0.85rem;
    color: var(--text);
    opacity: 0.7;
    font-style: italic;
    margin-top: -0.25rem;
  }

  .radio-group {
    display: flex;
    gap: 1.5rem;
    padding-top: 0.25rem;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: var(--text);
    font-size: 0.95rem;
  }

  .radio-option input[type='radio'] {
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .text-input {
    padding: 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background-color: rgba(0, 0, 0, 0.3);
    color: var(--text);
    font-size: 0.95rem;
    font-family: inherit;
    resize: vertical;
    min-height: 100px;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .text-input::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }

  .text-input:focus {
    outline: none;
    border-color: var(--hover);
    box-shadow: 0 0 0 3px rgba(120, 67, 145, 0.3);
  }

  .submit-message {
    padding: 1rem;
    border-radius: 0.5rem;
    font-weight: 500;
    text-align: center;
  }

  .submit-message.success {
    background-color: rgba(74, 222, 128, 0.2);
    color: #4ade80;
    border: 1px solid rgba(74, 222, 128, 0.4);
  }

  .submit-message.error {
    background-color: rgba(248, 113, 113, 0.2);
    color: #f87171;
    border: 1px solid rgba(248, 113, 113, 0.4);
  }

  .submit-button {
    padding: 0.875rem 1.5rem;
    border-radius: 0.5rem;
    border: none;
    background-color: var(--accent);
    color: var(--text);
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    transition:
      background-color 0.2s ease,
      transform 0.2s ease;
  }

  .submit-button:hover:not(:disabled) {
    background-color: var(--hover);
    transform: translateY(-1px);
  }

  .submit-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
