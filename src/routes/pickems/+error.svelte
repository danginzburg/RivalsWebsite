<script lang="ts">
  import { page } from '$app/stores'
  import { resolve } from '$app/paths'
  import { Target } from 'lucide-svelte'
  import PageContainer from '$lib/components/PageContainer.svelte'
</script>

<PageContainer>
  <div class="error-wrap">
    <div class="icon-ring">
      <Target size={48} strokeWidth={1.5} />
    </div>
    <h1 class="error-code">{$page.status}</h1>
    <p class="error-message">{$page.error?.message ?? 'Page not found'}</p>
    <p class="error-detail">
      There's no active Pick'em bracket right now. Check back when the next playoff season begins!
    </p>
    <a href={resolve('/')} class="home-link">Back to Home</a>
  </div>
</PageContainer>

<style>
  .error-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    min-height: 60vh;
    gap: 1rem;
    padding: 2rem 1rem;
  }

  .icon-ring {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: rgba(94, 52, 114, 0.18);
    border: 2px solid rgba(120, 67, 145, 0.35);
    color: var(--accent-text);
    margin-bottom: 0.5rem;
  }

  .error-code {
    font-size: 5rem;
    font-weight: 700;
    line-height: 1;
    color: var(--text);
    letter-spacing: -0.04em;
    opacity: 0.9;
  }

  .error-message {
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--text);
    opacity: 0.85;
    margin: 0;
  }

  .error-detail {
    font-size: 0.95rem;
    color: rgba(255, 255, 255, 0.55);
    max-width: 360px;
    line-height: 1.5;
    margin: 0;
  }

  .home-link {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.65rem 1.75rem;
    border-radius: 0.5rem;
    background: var(--hover);
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.15s ease;
  }

  .home-link:hover {
    background: var(--tertiary-background);
  }
</style>
