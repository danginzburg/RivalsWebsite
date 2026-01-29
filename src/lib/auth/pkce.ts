import { createHash, randomBytes } from 'crypto'

function base64url(input: Buffer) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32))
}

export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest()
  return base64url(hash)
}

export function generateState(): string {
  return base64url(randomBytes(16))
}
