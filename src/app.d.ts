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
        access_token?: string
        id_token: string
        refresh_token?: string
        exp: number
      }
      user: null | { sub: string; email?: string; name?: string; picture?: string; role?: string }
    }
  }
}

export {}
