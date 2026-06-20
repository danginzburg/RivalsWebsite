import { writable, derived } from 'svelte/store'

export type SessionUser = {
  sub: string
  email?: string
  name?: string
  picture?: string
  role?: string
}

export const user = writable<SessionUser | null>(null)
export const isLoading = writable(true)
export const isAuthenticated = derived(user, ($user) => $user !== null)
