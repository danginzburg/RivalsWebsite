<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import PageHeading from '$lib/components/PageHeading.svelte'
  import { User } from 'lucide-svelte'
  import { resolve } from '$app/paths'

  import { enhance } from '$app/forms'

  let { data, form }: PageProps = $props()

  // A failed submit echoes the typed values back so nothing is lost.
  let riotId = $derived(form?.riotId ?? data.profile.riotId)
  let displayName = $derived(form?.displayName ?? data.profile.displayName)
  let submitting = $state(false)
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-xl">
      <div class="mb-6">
        <PageHeading
          title="Link your Riot account"
          subtitle="Your Riot ID links match stats to you. Pick a different name to show on the site if you like."
          icon={User}
        />
      </div>

      <section
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <form
          method="POST"
          use:enhance={() => {
            submitting = true
            return async ({ update }) => {
              await update({ reset: false })
              submitting = false
            }
          }}
        >
          {#if data.returnTo}
            <input type="hidden" name="returnTo" value={data.returnTo} />
          {/if}

          <label
            for="riot-id"
            class="block text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Riot ID
          </label>
          <input
            id="riot-id"
            name="riot_id"
            required
            autocomplete="off"
            class="mt-2 w-full rounded-md border px-3 py-2 text-sm"
            style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
            placeholder="Name#TAG"
            bind:value={riotId}
          />
          <p class="mt-2 text-xs" style="color: rgba(255,255,255,0.65);">
            Your full Riot ID including the #tag. We check it with Riot to link your account.
          </p>

          <label
            for="display-name"
            class="mt-5 block text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Display name <span style="text-transform: none; font-weight: 400;">(optional)</span>
          </label>
          <input
            id="display-name"
            name="display_name"
            maxlength="40"
            class="mt-2 w-full rounded-md border px-3 py-2 text-sm"
            style="border-color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.25); color: var(--text);"
            placeholder="Defaults to your Riot name"
            bind:value={displayName}
          />
          <p class="mt-2 text-xs" style="color: rgba(255,255,255,0.65);">
            The name shown on the site instead of your Riot name. Leave blank to use your Riot name.
          </p>

          {#if form?.message}
            <div
              class="mt-3 rounded-md border p-3 text-sm"
              style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
            >
              {form.message}
            </div>
          {/if}

          <button
            type="submit"
            disabled={submitting}
            class="mt-4 w-full rounded-md px-4 py-3 text-base font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
            style="background: var(--accent); color: var(--text);"
          >
            {submitting ? 'Checking with Riot…' : 'Save'}
          </button>

          <!-- eslint-disable svelte/no-navigation-without-resolve -->
          <!-- returnTo is a server-validated same-site path -->
          <a
            href={data.returnTo ?? resolve(`/players/${data.profile.id}`)}
            class="mt-3 block text-center text-xs underline"
            style="color: rgba(255,255,255,0.6);"
          >
            Skip for now
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        </form>
      </section>
    </div>
  </div>
</PageContainer>
