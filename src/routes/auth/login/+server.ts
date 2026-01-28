import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { generateCodeVerifier, generateCodeChallenge, generateState } from '$lib/auth/pkce'
import { PUBLIC_AUTH0_DOMAIN, PUBLIC_AUTH0_CLIENT_ID } from '$env/static/public'

export const GET: RequestHandler = async ({ url, cookies }) => {
  const returnTo = url.searchParams.get('returnTo') || '/'

  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = generateState()

  // Store PKCE verifier and return URL in cookies
  cookies.set('pkce_verifier', verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 10, // 10 minutes
  })

  cookies.set('auth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 10,
  })

  cookies.set('auth_return_to', returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 10,
  })

  const authUrl = new URL(`https://${PUBLIC_AUTH0_DOMAIN}/authorize`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', PUBLIC_AUTH0_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', `${url.origin}/auth/callback`)
  authUrl.searchParams.set('scope', 'openid profile email')
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('connection', 'discord') // Force Discord login only

  redirect(303, authUrl.toString())
}
