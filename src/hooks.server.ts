import { redirect, type Handle } from '@sveltejs/kit'
import { readSessionCookie } from '$lib/server/auth/session'

// Routes that require authentication (add paths here)
const protectedRoutes: string[] = [
  '/signup',
  // '/scrim-finder',
  // '/profile',
  // '/dashboard',
]

// Check if a path matches any protected route
function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

export const handle: Handle = async ({ event, resolve }) => {
  const session = await readSessionCookie(event.cookies)

  event.locals.session = session
  event.locals.user = session
    ? { sub: session.sub, email: session.email, name: session.name, picture: session.picture }
    : null

  // Protect routes that require authentication
  if (isProtectedRoute(event.url.pathname) && !session) {
    // Store the original URL to redirect back after login
    const returnTo = encodeURIComponent(event.url.pathname + event.url.search)
    redirect(303, `/auth/login?returnTo=${returnTo}`)
  }

  return resolve(event)
}

declare global {
  namespace App {
    interface Locals {
      session: null | {
        sub: string
        email?: string
        name?: string
        picture?: string
        access_token?: string
        id_token: string
        refresh_token?: string
        exp: number
      }
      user: null | { sub: string; email?: string; name?: string; picture?: string }
    }
  }
}
