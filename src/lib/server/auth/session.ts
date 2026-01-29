import { SignJWT, jwtVerify } from 'jose'
import type { Cookies } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'

const COOKIE_NAME = 'app_session'

type SessionPayload = {
  sub: string
  email?: string
  name?: string
  picture?: string
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
  const jwt = await new SignJWT(payload as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(payload.exp) // use token exp
    .sign(secretKey())

  cookies.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
  })
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
