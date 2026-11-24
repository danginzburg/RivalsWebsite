import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { importDiscordPublicKey, verifyDiscordSignature } from './verify'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
/** The raw 32-byte key as hex, the way the Developer Portal shows it. */
const publicKeyHex = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')

function signed(body: string, timestamp = '1700000000') {
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex')
  return { body, timestamp, signature }
}

describe('verifyDiscordSignature', () => {
  it('accepts a correctly signed body', () => {
    const { body, timestamp, signature } = signed('{"type":1}')
    expect(verifyDiscordSignature(body, signature, timestamp, publicKeyHex)).toBe(true)
  })

  it('accepts an uppercase key', () => {
    const { body, timestamp, signature } = signed('{"type":1}')
    expect(verifyDiscordSignature(body, signature, timestamp, publicKeyHex.toUpperCase())).toBe(
      true
    )
  })

  it('rejects a tampered body', () => {
    const { timestamp, signature } = signed('{"type":1}')
    expect(verifyDiscordSignature('{"type":2}', signature, timestamp, publicKeyHex)).toBe(false)
  })

  it('rejects a different timestamp', () => {
    const { body, signature } = signed('{"type":1}', '1700000000')
    expect(verifyDiscordSignature(body, signature, '1700000001', publicKeyHex)).toBe(false)
  })

  it('rejects a signature from another key', () => {
    const other = generateKeyPairSync('ed25519')
    const body = '{"type":1}'
    const signature = sign(null, Buffer.from('1' + body), other.privateKey).toString('hex')
    expect(verifyDiscordSignature(body, signature, '1', publicKeyHex)).toBe(false)
  })

  it('rejects missing or malformed headers', () => {
    const { body, timestamp, signature } = signed('{}')
    expect(verifyDiscordSignature(body, null, timestamp, publicKeyHex)).toBe(false)
    expect(verifyDiscordSignature(body, signature, null, publicKeyHex)).toBe(false)
    expect(verifyDiscordSignature(body, 'zz' + signature.slice(2), timestamp, publicKeyHex)).toBe(
      false
    )
    expect(verifyDiscordSignature(body, signature.slice(2), timestamp, publicKeyHex)).toBe(false)
  })

  it('rejects when no key is configured or the key is malformed', () => {
    const { body, timestamp, signature } = signed('{}')
    expect(verifyDiscordSignature(body, signature, timestamp, undefined)).toBe(false)
    expect(verifyDiscordSignature(body, signature, timestamp, 'abc')).toBe(false)
    expect(importDiscordPublicKey('x'.repeat(64))).toBeNull()
  })
})
