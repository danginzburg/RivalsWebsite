<script lang="ts">
  import { page } from '$app/stores'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import SignupForm from '$lib/components/SignupForm.svelte'
  import { LogIn, UserPlus } from 'lucide-svelte'

  let { data } = $props()
  const user = $derived($page.data.user)

  function handleLogin() {
    window.location.href = '/auth/login'
  }
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-2xl">
      <div class="mb-8 flex flex-col items-center">
        <UserPlus size={48} class="mb-4" style="color: var(--text);" />
        <h1 class="responsive-title mb-2 text-center">Season 4 Registration</h1>
        <p class="responsive-text mb-6 text-center" style="color: var(--text);">
          Complete the form below to register for Throw City Rivals Season 4
        </p>
      </div>

      {#if !user}
        <div class="info-card info-card-surface flex flex-col items-center gap-4 p-8 text-center">
          <LogIn size={32} style="color: rgba(255,255,255,0.75);" />
          <p class="text-lg" style="color: var(--text);">
            You must be logged in to register for Season 4.
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
        <SignupForm existingRegistration={data.existingRegistration} />
      {/if}
    </div>
  </div>
</PageContainer>
