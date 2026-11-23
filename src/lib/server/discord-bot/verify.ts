import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/**
 * Discord signs every interaction (slash command, autocomplete) with the
 * application's Ed25519 key. The signature covers the timestamp header followed
 * by the raw request body. Discord also sends deliberately bad signatures to
 * the endpoint and disables it if any is accepted, so every request must pass
 * this before it is parsed.
 */

/** DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

const HEX_RE = /^[0-9a-f]+$/i

const keyCache = new Map<string, KeyObject>()

/** The key from the Developer Portal's hex "Public Key", or null if it is malformed. */
export function importDiscordPublicKey(hex: string): KeyObject | null {
  const clean = hex.trim().toLowerCase()
  const cached = keyCache.get(clean)
  if (cached) return cached
  if (clean.length !== 64 || !HEX_RE.test(clean)) return null
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(clean, 'hex')]),
      format: 'der',
      type: 'spki',
    })
    keyCache.set(clean, key)
    return key
  } catch {
    return null
  }
}

/**
 * True when `signature` (hex, from `X-Signature-Ed25519`) is the application
 * key's signature of `timestamp + body`. Missing or malformed input is false.
 */
export function verifyDiscordSignature(
  body: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  publicKeyHex: string | null | undefined
): boolean {
  if (!signature || !timestamp || !publicKeyHex) return false
  if (signature.length !== 128 || !HEX_RE.test(signature)) return false
  const key = importDiscordPublicKey(publicKeyHex)
  if (!key) return false
  try {
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, 'hex'))
  } catch {
    return false
  }
}
