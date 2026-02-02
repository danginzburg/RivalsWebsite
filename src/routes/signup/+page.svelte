<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import SignupForm from '$lib/components/SignupForm.svelte'
  import { LogIn, UserPlus } from 'lucide-svelte'

  const user = $derived($page.data.user)

  function handleLogin() {
    window.location.href = '/auth/login'
  }
</script>

<PageContainer>
  <div class="signup-page-wrapper">
    <div class="signup-container">
      <div class="header-section">
        <UserPlus size={48} class="header-icon" />
        <h1 class="responsive-title mb-2 text-center">Season 4 Registration</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Complete the form below to register for Throw City Rivals Season 4
        </p>
      </div>

      {#if !user}
        <div class="login-prompt info-card info-card-surface">
          <LogIn size={32} class="login-icon" />
          <p>You must be logged in to register for Season 4.</p>
          <button type="button" class="login-button" onclick={handleLogin}>
            <LogIn size={18} />
            <span>Login to Continue</span>
          </button>
        </div>
      {:else}
        <SignupForm />
      {/if}
    </div>
  </div>
</PageContainer>

<style>
  .signup-page-wrapper {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 2rem 1rem;
    min-height: 60vh;
  }

  .signup-container {
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
</style>
