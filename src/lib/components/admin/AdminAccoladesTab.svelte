<script lang="ts">
  import { builtInAccoladeIcons } from '$lib/accolades/icons'
  import CustomSelect from '$lib/components/CustomSelect.svelte'

  type Accolade = {
    id: string
    name: string
    logo_path: string | null
    logo_url: string | null
    icon_key: string | null
    assignments: Array<{
      id: string
      profile_id: string
      display_name: string
      context?: string | null
    }>
  }

  interface Props {
    accolades: Accolade[]
    accoladesLoaded: boolean
    createAccoladeName: string
    createAccoladeIconKey: string
    isCreatingAccolade: boolean
    accoladeAssignProfileId: Record<string, string>
    accoladeAssignContext: Record<string, string>
    editingAccoladeId: string | null
    editAccoladeName: string
    accoladeLogoStatus: Record<string, 'uploading' | 'done' | null>
    onCreateAccoladeNameChange: (value: string) => void
    onCreateAccoladeIconKeyChange: (value: string) => void
    onCreateAccoladeLogoInput: (file: File | null) => void
    onCreateAccolade: () => void
    onEditAccolade: (accolade: Accolade) => void
    onCancelEditAccolade: () => void
    onEditAccoladeNameChange: (value: string) => void
    onRenameAccolade: (accoladeId: string) => void
    onDeleteAccolade: (accoladeId: string) => void
    onUpdateAccoladeLogo: (accoladeId: string, file: File) => void
    onAssignProfileChange: (accoladeId: string, value: string) => void
    onAssignContextChange: (accoladeId: string, value: string) => void
    onAssignAccolade: (accoladeId: string) => void
    onSetAccoladeIconKey: (accoladeId: string, iconKey: string) => void
    onUnassignAccolade: (accoladeId: string, assignmentId: string) => void
  }

  let {
    accolades,
    accoladesLoaded,
    createAccoladeName,
    createAccoladeIconKey,
    isCreatingAccolade,
    accoladeAssignProfileId,
    accoladeAssignContext,
    editingAccoladeId,
    editAccoladeName,
    accoladeLogoStatus,
    onCreateAccoladeNameChange,
    onCreateAccoladeIconKeyChange,
    onCreateAccoladeLogoInput,
    onCreateAccolade,
    onEditAccolade,
    onCancelEditAccolade,
    onEditAccoladeNameChange,
    onRenameAccolade,
    onDeleteAccolade,
    onUpdateAccoladeLogo,
    onAssignProfileChange,
    onAssignContextChange,
    onAssignAccolade,
    onSetAccoladeIconKey,
    onUnassignAccolade,
  }: Props = $props()

  const iconKeyLabels: Record<string, string> = {
    gold_medal: 'Gold Medal',
    silver_medal: 'Silver Medal',
    bronze_medal: 'Bronze Medal',
    trophy: 'Trophy',
    mvp_trophy: 'MVP Trophy',
  }

  const iconKeyOptions = Object.keys(builtInAccoladeIcons).map((key) => ({
    value: key,
    label: iconKeyLabels[key] ?? key,
  }))
</script>

<div class="grid grid-cols-1 gap-4">
  <section class="admin-bordered p-3">
    <h3
      class="mb-3 text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Create Accolade
    </h3>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <input
        value={createAccoladeName}
        class="admin-input"
        placeholder="Accolade name"
        oninput={(e) => onCreateAccoladeNameChange((e.currentTarget as HTMLInputElement).value)}
      />
      <CustomSelect
        options={iconKeyOptions}
        value={createAccoladeIconKey}
        compact={true}
        placeholder="No preset icon"
        onSelect={(value) => onCreateAccoladeIconKeyChange(value)}
      />
      <input
        type="file"
        accept="image/*"
        class="admin-file"
        oninput={(e) =>
          onCreateAccoladeLogoInput((e.currentTarget as HTMLInputElement).files?.[0] ?? null)}
      />
      <button
        type="button"
        class="admin-btn admin-btn-go text-sm"
        onclick={onCreateAccolade}
        disabled={isCreatingAccolade}
      >
        {isCreatingAccolade ? 'Creating...' : 'Create'}
      </button>
    </div>
  </section>

  <section class="admin-bordered p-3">
    <h3
      class="mb-3 text-sm font-semibold tracking-wide uppercase"
      style="color: rgba(255,255,255,0.8);"
    >
      Accolades ({accolades.length})
    </h3>
    {#if !accoladesLoaded}
      <p class="text-sm" style="color: rgba(255,255,255,0.6);">Loading accolades...</p>
    {:else if accolades.length === 0}
      <p class="text-sm" style="color: rgba(255,255,255,0.72);">No accolades created yet.</p>
    {:else}
      <div class="space-y-3">
        {#each accolades as accolade (accolade.id)}
          {@const iconSrc = accolade.icon_key ? builtInAccoladeIcons[accolade.icon_key] : null}
          <article
            class="rounded-md border p-3"
            style="border-color: rgba(255,255,255,0.10); background: rgba(0,0,0,0.18);"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 items-center gap-3">
                {#if iconSrc || accolade.logo_url}
                  <img
                    src={iconSrc ?? accolade.logo_url}
                    alt={accolade.name}
                    class="h-10 w-10 rounded object-contain"
                  />
                {/if}
                <div class="min-w-0">
                  {#if editingAccoladeId === accolade.id}
                    <input
                      value={editAccoladeName}
                      class="admin-input"
                      oninput={(e) =>
                        onEditAccoladeNameChange((e.currentTarget as HTMLInputElement).value)}
                    />
                  {:else}
                    <div class="truncate text-sm font-semibold" style="color: var(--text);">
                      {accolade.name}
                    </div>
                  {/if}
                  <div class="mt-1 text-xs" style="color: rgba(255,255,255,0.62);">
                    {accolade.assignments.length} assignment{accolade.assignments.length === 1
                      ? ''
                      : 's'}
                  </div>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                {#if editingAccoladeId === accolade.id}
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-info"
                    onclick={() => onRenameAccolade(accolade.id)}>Save</button
                  >
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-neutral"
                    onclick={onCancelEditAccolade}>Cancel</button
                  >
                {:else}
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-neutral"
                    onclick={() => onEditAccolade(accolade)}>Rename</button
                  >
                  <button
                    type="button"
                    class="admin-btn admin-btn-sm admin-btn-danger"
                    onclick={() => onDeleteAccolade(accolade.id)}>Delete</button
                  >
                {/if}
              </div>
            </div>

            <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <CustomSelect
                options={iconKeyOptions}
                value={accolade.icon_key ?? ''}
                compact={true}
                placeholder="No preset icon"
                onSelect={(value) => onSetAccoladeIconKey(accolade.id, value)}
              />
              <input
                type="file"
                accept="image/*"
                class="admin-file"
                oninput={(e) => {
                  const file = (e.currentTarget as HTMLInputElement).files?.[0]
                  if (file) onUpdateAccoladeLogo(accolade.id, file)
                }}
              />
              <input
                value={accoladeAssignProfileId[accolade.id] ?? ''}
                class="admin-input"
                placeholder="Player name"
                oninput={(e) =>
                  onAssignProfileChange(accolade.id, (e.currentTarget as HTMLInputElement).value)}
              />
              <input
                value={accoladeAssignContext[accolade.id] ?? ''}
                class="admin-input"
                placeholder="Context"
                oninput={(e) =>
                  onAssignContextChange(accolade.id, (e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <div class="text-xs" style="color: rgba(255,255,255,0.62);">
                {#if accoladeLogoStatus[accolade.id] === 'uploading'}
                  Uploading logo...
                {:else if accoladeLogoStatus[accolade.id] === 'done'}
                  Logo updated.
                {/if}
              </div>
              <button
                type="button"
                class="admin-btn admin-btn-sm admin-btn-info"
                onclick={() => onAssignAccolade(accolade.id)}
              >
                Assign
              </button>
            </div>

            {#if accolade.assignments.length > 0}
              <div class="mt-3 flex flex-wrap gap-2">
                {#each accolade.assignments as assignment (assignment.id)}
                  <span
                    class="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                    style="border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.84);"
                  >
                    {assignment.display_name}{assignment.context ? ` - ${assignment.context}` : ''}
                    <button
                      type="button"
                      style="color: #fca5a5;"
                      onclick={() => onUnassignAccolade(accolade.id, assignment.id)}>Remove</button
                    >
                  </span>
                {/each}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>
