import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import type { Cookies } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'

const COOKIE_NAME = 'app_session'

/** How long a login lasts. The cookie persists across browser restarts. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

/** Re-issue the cookie once less than this much lifetime remains (sliding expiry). */
const RENEW_BELOW_SECONDS = 60 * 60 * 24 * 15 // 15 days

type SessionPayload = {
  sub: string
  email?: string
  name?: string
  picture?: string
  /** Discord username, when the account signed in through Discord. */
  discord_username?: string
  access_token?: string
  id_token: string
  refresh_token?: string
  exp: number // seconds since epoch
}

function secretKey() {
  if (!env.AUTH_SESSION_SECRET) throw new Error('Missing AUTH_SESSION_SECRET')
  return new TextEncoder().encode(env.AUTH_SESSION_SECRET)
}

export async function setSessionCookie(cookies: Cookies, payload: SessionPayload) {
  const jwt = await new SignJWT(payload as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(payload.exp)
    .sign(secretKey())

  cookies.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    // Without maxAge the browser drops the cookie when it closes.
    maxAge: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
  })
}

/** Extend an active session so regular visitors never get logged out. */
export async function renewSessionCookieIfStale(cookies: Cookies, session: SessionPayload) {
  const now = Math.floor(Date.now() / 1000)
  if (session.exp - now > RENEW_BELOW_SECONDS) return
  await setSessionCookie(cookies, { ...session, exp: now + SESSION_TTL_SECONDS })
}

export async function clearSessionCookie(cookies: Cookies) {
  cookies.delete(COOKIE_NAME, { path: '/' })
}

export async function readSessionCookie(cookies: Cookies): Promise<SessionPayload | null> {
  const token = cookies.get(COOKIE_NAME)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}
