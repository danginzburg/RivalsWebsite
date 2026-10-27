<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { roleSelectOptions } from '$lib/admin/options'

  interface UserRecord {
    id: string
    display_name?: string | null
    email?: string | null
    role?: string | null
    riot_tag?: string | null
    riot_id?: string | null
    riot_linked?: boolean
    unclaimed?: boolean
  }

  interface Props {
    users: UserRecord[]
    displayedUsers: UserRecord[]
    usersSearch: string
    userDisplayNameForm: Record<string, string>
    onUsersSearchChange: (value: string) => void
    onUserDisplayNameInput: (userId: string, value: string) => void
    onRequestRoleChange: (
      userId: string,
      userName: string,
      currentRole: string,
      newRole: string
    ) => void
    onRequestUserDisplayNameSave: (userId: string, userName: string) => void
  }

  let {
    users,
    displayedUsers,
    usersSearch,
    userDisplayNameForm,
    onUsersSearchChange,
    onUserDisplayNameInput,
    onRequestRoleChange,
    onRequestUserDisplayNameSave,
  }: Props = $props()
</script>

<!-- Display name is the player's chosen site name; the Riot ID under it is the
     identity stats link to, so a renamed player is still recognisable. -->
{#snippet identity(user: UserRecord)}
  <div class="font-semibold" style="color: var(--title);">{user.display_name || '—'}</div>
  <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
    <span style="color: rgba(255,255,255,0.65);">{user.riot_id || 'No Riot ID'}</span>
    {#if user.unclaimed}
      <span
        class="rounded px-1.5 py-0.5"
        style="background: rgba(148,163,184,0.14); color: #cbd5e1;"
        title="Seen in match imports but has never logged in. The display name carries over to their account when they do."
        >Never logged in</span
      >
    {:else if user.riot_linked}
      <span
        class="rounded px-1.5 py-0.5"
        style="background: rgba(34,197,94,0.12); color: #86efac;"
        title="Linked by PUUID (match import, Identities tab or login)">Linked</span
      >
    {:else}
      <span
        class="rounded px-1.5 py-0.5"
        style="background: rgba(250,204,21,0.12); color: #fde68a;"
        title="No PUUID yet — they will be prompted for their Riot ID on next login"
        >Not linked</span
      >
    {/if}
  </div>
{/snippet}

{#if users.length === 0}
  <div class="py-10 text-center" style="color: rgba(255,255,255,0.72);">No users found.</div>
{:else}
  <input
    bind:value={usersSearch}
    placeholder="Search users by name, Riot ID, email, role"
    class="admin-input mb-3"
    oninput={(e) => onUsersSearchChange((e.currentTarget as HTMLInputElement).value)}
  />
  <div class="space-y-3 md:hidden">
    {#each displayedUsers as user (user.id)}
      <article class="admin-card p-3">
        <div class="mb-2">
          {@render identity(user)}
        </div>
        {#if !user.unclaimed}
          <div class="w-40">
            <CustomSelect
              options={roleSelectOptions}
              value={user.role ?? 'user'}
              placeholder="Select role"
              onSelect={(value) =>
                onRequestRoleChange(user.id, user.display_name || '—', user.role || 'user', value)}
            />
          </div>
        {/if}

        <div class="mt-3 flex items-end gap-2">
          <label class="min-w-0 flex-1 text-xs" style="color: rgba(255,255,255,0.82);">
            Display name
            <input
              value={userDisplayNameForm[user.id] ?? ''}
              class="admin-input mt-1"
              placeholder="Blank = Riot name"
              maxlength="40"
              oninput={(e) =>
                onUserDisplayNameInput(user.id, (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button
            type="button"
            class="admin-btn admin-btn-sm admin-btn-info"
            onclick={() => onRequestUserDisplayNameSave(user.id, user.display_name || '—')}
          >
            Save
          </button>
        </div>

        <div class="mt-3 text-xs" style="color: rgba(255,255,255,0.55);">
          Account-level role management only.
        </div>
      </article>
    {/each}
  </div>

  <div class="hidden overflow-x-auto md:block">
    <table class="w-full text-left text-sm">
      <thead>
        <tr class="text-xs tracking-wide uppercase opacity-70">
          <th class="px-3 py-2">Player</th>
          <th class="px-3 py-2">Role</th>
          <th class="px-3 py-2">Display name</th>
        </tr>
      </thead>
      <tbody>
        {#each displayedUsers as user (user.id)}
          <tr class="border-t" style="border-color: rgba(255,255,255,0.1);">
            <td class="px-3 py-2">{@render identity(user)}</td>
            <td class="px-3 py-2">
              {#if user.unclaimed}
                <span class="text-xs" style="color: rgba(255,255,255,0.55);">—</span>
              {:else}
                <div class="w-40">
                  <CustomSelect
                    options={roleSelectOptions}
                    value={user.role ?? 'user'}
                    placeholder="Select role"
                    onSelect={(value) =>
                      onRequestRoleChange(
                        user.id,
                        user.display_name || '—',
                        user.role || 'user',
                        value
                      )}
                  />
                </div>
              {/if}
            </td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <input
                  value={userDisplayNameForm[user.id] ?? ''}
                  class="admin-input max-w-[220px]"
                  placeholder="Blank = Riot name"
                  maxlength="40"
                  oninput={(e) =>
                    onUserDisplayNameInput(user.id, (e.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="admin-btn admin-btn-sm admin-btn-info"
                  onclick={() => onRequestUserDisplayNameSave(user.id, user.display_name || '—')}
                >
                  Save
                </button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
