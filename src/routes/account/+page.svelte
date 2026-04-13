<script lang="ts">
  import type { PageProps } from './$types'
  import PageContainer from '$lib/components/PageContainer.svelte'
  import { User } from 'lucide-svelte'

  import { enhance } from '$app/forms'

  /** GET always redirects; `profile` is only used if load data is ever returned. */
  type AccountPageData = { profile: { riot_id_base?: string | null } }
  let { data, form }: PageProps = $props()
  const profile = $derived((data as unknown as AccountPageData).profile)

  let value = $state('')

  $effect(() => {
    value = profile.riot_id_base ?? ''
  })
</script>

<PageContainer>
  <div class="flex justify-center px-4 py-8">
    <div class="w-full max-w-xl">
      <div class="mb-6 flex items-center gap-3">
        <User size={34} style="color: var(--text);" />
        <div>
          <h1 class="responsive-title">Account</h1>
          <p class="text-sm" style="color: rgba(255,255,255,0.72);">
            Set your Riot ID base name (name before #tag) so match stats can link to you.
          </p>
        </div>
      </div>

      <section
        class="rounded-md border p-4"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <form method="POST" use:enhance>
          <label
            for="riot-id-base"
            class="block text-xs font-semibold tracking-wide uppercase"
            style="color: rgba(255,255,255,0.72);"
          >
            Riot ID Base Name
          </label>
          <input
            id="riot-id-base"
            name="riot_id_base"
            class="mt-2 w-full rounded-md border px-3 py-2 text-sm"
            style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
            placeholder="Example: Ginzburg"
            bind:value
          />
          <p class="mt-2 text-xs" style="color: rgba(255,255,255,0.65);">
            Do not include the #tag. Stats imports use this field for matching.
          </p>

          {#if form?.success === false}
            <div
              class="mt-3 rounded-md border p-3 text-sm"
              style="border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.08); color: #fecaca;"
            >
              {form.message ?? 'Failed to update'}
            </div>
          {/if}

          {#if form?.success === true}
            <div
              class="mt-3 rounded-md border p-3 text-sm"
              style="border-color: rgba(34,197,94,0.30); background: rgba(34,197,94,0.08); color: #86efac;"
            >
              Saved.
            </div>
          {/if}

          <button
            type="submit"
            class="mt-4 w-full rounded-md px-4 py-3 text-base font-bold transition-opacity hover:opacity-90"
            style="background: var(--accent); color: var(--text);"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  </div>
</PageContainer>
