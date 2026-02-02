import { redirect, type Handle } from '@sveltejs/kit'
import { readSessionCookie } from '$lib/server/auth/session'
import { supabaseAdmin } from '$lib/supabase/admin'

// Routes that require hard redirect to login (add paths here)
// Note: Pages with graceful "Login to Continue" UI don't need to be listed here
const protectedRoutes: string[] = []

// Check if a path matches any protected route
function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

export const handle: Handle = async ({ event, resolve }) => {
  const session = await readSessionCookie(event.cookies)

  event.locals.session = session

  if (session) {
    // Fetch user role from database
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('auth0_sub', session.sub)
      .single()

    event.locals.user = {
      sub: session.sub,
      email: session.email,
      name: session.name,
      picture: session.picture,
      role: profile?.role || 'user',
    }
  } else {
    event.locals.user = null
  }

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
      user: null | { sub: string; email?: string; name?: string; picture?: string; role?: string }
    }
  }
}
