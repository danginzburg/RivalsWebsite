import { writable, derived } from 'svelte/store'
import type { User } from '@auth0/auth0-spa-js'
import { getAuth0 } from '$lib/auth/auth0'
import { browser } from '$app/environment'

// User state
export const user = writable<User | null>(null)
export const isLoading = writable(true)
export const isAuthenticated = derived(user, ($user) => $user !== null)

// TODO: Add your permission types here
// export type UserRole = 'guest' | 'user' | 'admin'
// export const userRole = writable<UserRole>('guest')

// Initialize auth state
export async function initAuth(): Promise<void> {
  if (!browser) return

  try {
    const auth0 = await getAuth0()
    const authenticated = await auth0.isAuthenticated()

    if (authenticated) {
      const auth0User = await auth0.getUser()
      user.set(auth0User ?? null)
      // TODO: Set user role/permissions here
    } else {
      user.set(null)
    }
  } catch (error) {
    console.error('Auth initialization error:', error)
    user.set(null)
  } finally {
    isLoading.set(false)
  }
}

// Login function
export async function login(): Promise<void> {
  if (!browser) return
  const auth0 = await getAuth0()
  await auth0.loginWithRedirect()
}

// Logout function
export async function logout(): Promise<void> {
  if (!browser) return
  const auth0 = await getAuth0()
  user.set(null)
  await auth0.logout({
    logoutParams: {
      returnTo: `${window.location.origin}/auth/logout`,
    },
  })
}

// Handle the callback after login redirect
export async function handleAuthCallback(): Promise<boolean> {
  if (!browser) return false

  try {
    const auth0 = await getAuth0()
    const query = window.location.search

    if (query.includes('code=') && query.includes('state=')) {
      await auth0.handleRedirectCallback()
      const auth0User = await auth0.getUser()
      user.set(auth0User ?? null)
      return true
    }
    return false
  } catch (error) {
    console.error('Auth callback error:', error)
    return false
  }
}

// TODO: Add permission helper functions as needed
// export function hasPermission(permission: string): boolean { ... }
