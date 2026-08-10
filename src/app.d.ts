// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
  namespace App {
    interface Locals {
      session: null | {
        sub: string
        email?: string
        name?: string
        picture?: string
        /** Discord username, when the account signed in through Discord. */
        discord_username?: string
        access_token?: string
        id_token: string
        refresh_token?: string
        exp: number
      }
      user: null | {
        sub: string
        email?: string
        name?: string
        picture?: string
        discord_username?: string
        role?: string
      }
    }
  }
}

export {}
