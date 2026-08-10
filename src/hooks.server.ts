import { redirect, type Handle } from '@sveltejs/kit'
import { readSessionCookie } from '$lib/server/auth/session'
import { supabaseAdmin } from '$lib/supabase/admin'
import { profileRoleCache } from '$lib/server/cache'
import { enforceRateLimit } from '$lib/server/rate-limit'

// Routes that require hard redirect to login (add paths here)
// Note: Pages with graceful "Login to Continue" UI don't need to be listed here
const protectedRoutes: string[] = []

// Check if a path matches any protected route
function isProtectedRoute(pathname: string): boolean {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

/** Methods that change state and therefore get the stricter budget. */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Public GET routes safe to cache at the CDN/browser for a short window.
 * Anything user-specific or admin-only is deliberately absent.
 */
const CACHEABLE_PAGES = [
  '/leaderboard',
  '/stats',
  '/events',
  '/hall-of-fame',
  '/faq',
  '/rulebook',
  '/teams',
]

function isCacheablePage(pathname: string): boolean {
  return CACHEABLE_PAGES.some((route) => pathname === route || pathname.startsWith(route + '/'))
}

/**
 * Identify the caller for rate limiting: the session subject when signed in,
 * otherwise the client address. Behind a proxy, `getClientAddress()` relies on
 * the adapter honoring X-Forwarded-For.
 */
function rateLimitKey(event: Parameters<Handle>[0]['event'], suffix: string): string {
  const sub = event.locals.session?.sub
  if (sub) return `${suffix}:user:${sub}`
  try {
    return `${suffix}:ip:${event.getClientAddress()}`
  } catch {
    return `${suffix}:ip:unknown`
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const session = await readSessionCookie(event.cookies)

  event.locals.session = session

  if (session) {
    // Cached: this lookup runs on every authenticated request, and a role
    // changes far less often than a page is loaded.
    const profile = await profileRoleCache.wrap(session.sub, async () => {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('auth0_sub', session.sub)
        .single()
      return data ?? null
    })

    event.locals.user = {
      sub: session.sub,
      email: session.email,
      name: session.name,
      picture: session.picture,
      discord_username: session.discord_username,
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

  // Rate limit the API surface. Individual endpoints keep their own tighter
  // budgets; this is the blanket ceiling that catches everything else.
  const pathname = event.url.pathname
  if (pathname.startsWith('/api/')) {
    if (WRITE_METHODS.has(event.request.method)) {
      enforceRateLimit(rateLimitKey(event, 'api:write'), {
        limit: 60,
        windowMs: 60_000,
        message: 'Too many requests. Please slow down.',
      })
    } else {
      enforceRateLimit(rateLimitKey(event, 'api:read'), {
        limit: 300,
        windowMs: 60_000,
        message: 'Too many requests. Please slow down.',
      })
    }
  }

  const response = await resolve(event)

  // Public, signed-out page reads can be served from cache briefly.
  // Signed-in responses vary per user, so they stay uncacheable.
  if (
    event.request.method === 'GET' &&
    !session &&
    response.status === 200 &&
    isCacheablePage(pathname)
  ) {
    response.headers.set(
      'cache-control',
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
    )
  }

  return response
}
