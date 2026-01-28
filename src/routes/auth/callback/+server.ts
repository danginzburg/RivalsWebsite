import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { setSessionCookie } from '$lib/server/auth/session'
import { createClient } from '@supabase/supabase-js'
import { env as publicEnv } from '$env/dynamic/public'
import { env } from '$env/dynamic/private'

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) {
    console.error('Auth0 error:', error, url.searchParams.get('error_description'))
    redirect(303, '/?error=auth_failed')
  }

  const storedState = cookies.get('auth_state')
  const verifier = cookies.get('pkce_verifier')
  const returnTo = cookies.get('auth_return_to') || '/'

  // Clean up auth cookies
  cookies.delete('auth_state', { path: '/' })
  cookies.delete('pkce_verifier', { path: '/' })
  cookies.delete('auth_return_to', { path: '/' })

  if (!code || !state || state !== storedState || !verifier) {
    redirect(303, '/?error=invalid_state')
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(`https://${publicEnv.PUBLIC_AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: publicEnv.PUBLIC_AUTH0_CLIENT_ID,
      client_secret: env.AUTH0_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
      code_verifier: verifier,
    }),
  })

  if (!tokenResponse.ok) {
    console.error('Token exchange failed:', await tokenResponse.text())
    redirect(303, '/?error=token_exchange_failed')
  }

  const tokens = await tokenResponse.json()

  // Get user info from Auth0
  const userInfoResponse = await fetch(`https://${publicEnv.PUBLIC_AUTH0_DOMAIN}/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!userInfoResponse.ok) {
    console.error('User info failed:', await userInfoResponse.text())
    redirect(303, '/?error=userinfo_failed')
  }

  const userInfo = await userInfoResponse.json()

  // Set session cookie
  await setSessionCookie(cookies, {
    sub: userInfo.sub,
    email: userInfo.email,
    name: userInfo.name || userInfo.nickname,
    picture: userInfo.picture,
    access_token: tokens.access_token,
    id_token: tokens.id_token,
    refresh_token: tokens.refresh_token,
    exp: Math.floor(Date.now() / 1000) + tokens.expires_in,
  })

  // Sync profile to Supabase using service role (bypasses RLS)
  const supabaseAdmin = createClient(publicEnv.PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('auth0_sub', userInfo.sub)
    .maybeSingle()

  if (!existing) {
    await supabaseAdmin.from('profiles').insert({
      auth0_sub: userInfo.sub,
      email: userInfo.email ?? null,
      display_name: userInfo.name ?? userInfo.nickname ?? null,
      avatar_url: userInfo.picture ?? null,
    })
  } else {
    await supabaseAdmin
      .from('profiles')
      .update({
        email: userInfo.email ?? null,
        display_name: userInfo.name ?? userInfo.nickname ?? null,
        avatar_url: userInfo.picture ?? null,
      })
      .eq('auth0_sub', userInfo.sub)
  }

  redirect(303, returnTo)
}
