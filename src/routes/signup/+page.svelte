<script lang="ts">
  import PageContainer from '$lib/components/PageContainer.svelte'
  import SignupForm from '$lib/components/SignupForm.svelte'
</script>

<PageContainer>
  <div class="signup-page-wrapper">
    <div class="signup-container">
      <h1 class="responsive-title mb-2 text-center">Season 4 Registration</h1>
      <p class="responsive-text mb-8 text-center" style="color: var(--text);">
        Complete the form below to register for Throw City Rivals Season 4
      </p>
      <SignupForm />
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
</style>
