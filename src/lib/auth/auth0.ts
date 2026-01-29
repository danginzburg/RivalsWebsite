import { createAuth0Client, type Auth0Client } from '@auth0/auth0-spa-js'

let auth0: Auth0Client | null = null

export async function getAuth0(): Promise<Auth0Client> {
  if (auth0) return auth0

  auth0 = await createAuth0Client({
    domain: import.meta.env.PUBLIC_AUTH0_DOMAIN,
    clientId: import.meta.env.PUBLIC_AUTH0_CLIENT_ID,
    authorizationParams: {
      redirect_uri: `${window.location.origin}/auth/callback`,
    },
    cacheLocation: 'localstorage', // simplest; change later if you want
    useRefreshTokens: true,
  })

  return auth0
}
