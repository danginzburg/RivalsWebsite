<script lang="ts">
  import CustomSelect from '$lib/components/CustomSelect.svelte'
  import { roleSelectOptions } from '$lib/admin/options'

  interface UserRecord {
    id: string
    display_name?: string | null
    email?: string | null
    role?: string | null
  }

  interface Props {
    users: UserRecord[]
    displayedUsers: UserRecord[]
    usersSearch: string
    userRiotIdForm: Record<string, string>
    onUsersSearchChange: (value: string) => void
    onUserRiotIdInput: (userId: string, value: string) => void
    onRequestRoleChange: (
      userId: string,
      userName: string,
      currentRole: string,
      newRole: string
    ) => void
    onRequestUserRiotIdSave: (userId: string, userName: string) => void
  }

  let {
    users,
    displayedUsers,
    usersSearch,
    userRiotIdForm,
    onUsersSearchChange,
    onUserRiotIdInput,
    onRequestRoleChange,
    onRequestUserRiotIdSave,
  }: Props = $props()
</script>

{#if users.length === 0}
  <div class="py-10 text-center" style="color: rgba(255,255,255,0.72);">No users found.</div>
{:else}
  <input
    bind:value={usersSearch}
    placeholder="Search users by Discord, email, role"
    class="mb-3 w-full rounded-md border px-3 py-2 text-sm"
    style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
    oninput={(e) => onUsersSearchChange((e.currentTarget as HTMLInputElement).value)}
  />
  <div class="space-y-3 md:hidden">
    {#each displayedUsers as user (user.id)}
      <article
        class="rounded-lg border p-3"
        style="border-color: rgba(255,255,255,0.12); background: rgba(0,0,0,0.2);"
      >
        <div class="mb-2 font-semibold" style="color: var(--title);">
          {user.display_name || '—'}
        </div>
        <div class="w-40">
          <CustomSelect
            options={roleSelectOptions}
            value={user.role ?? 'user'}
            placeholder="Select role"
            onSelect={(value) =>
              onRequestRoleChange(user.id, user.display_name || '—', user.role || 'user', value)}
          />
        </div>

        <div class="mt-3 flex items-end gap-2">
          <label class="min-w-0 flex-1 text-xs" style="color: rgba(255,255,255,0.82);">
            Riot ID
            <input
              value={userRiotIdForm[user.id] ?? ''}
              class="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
              placeholder="Riot ID base"
              oninput={(e) =>
                onUserRiotIdInput(user.id, (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button
            type="button"
            class="rounded px-3 py-2 text-xs font-semibold"
            style="background: rgba(59,130,246,0.2); color: #93c5fd;"
            onclick={() => onRequestUserRiotIdSave(user.id, user.display_name || '—')}
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
          <th class="px-3 py-2">Discord</th>
          <th class="px-3 py-2">Role</th>
          <th class="px-3 py-2">Riot ID</th>
        </tr>
      </thead>
      <tbody>
        {#each displayedUsers as user (user.id)}
          <tr class="border-t" style="border-color: rgba(255,255,255,0.1);">
            <td class="px-3 py-2 font-semibold">{user.display_name || '—'}</td>
            <td class="px-3 py-2">
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
            </td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-2">
                <input
                  value={userRiotIdForm[user.id] ?? ''}
                  class="w-full max-w-[220px] rounded-md border px-3 py-2 text-sm"
                  style="border-color: rgba(255,255,255,0.2); background: rgba(0,0,0,0.25); color: var(--text);"
                  placeholder="Riot ID base"
                  oninput={(e) =>
                    onUserRiotIdInput(user.id, (e.currentTarget as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="rounded px-3 py-2 text-xs font-semibold"
                  style="background: rgba(59,130,246,0.2); color: #93c5fd;"
                  onclick={() => onRequestUserRiotIdSave(user.id, user.display_name || '—')}
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
