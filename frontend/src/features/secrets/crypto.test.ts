import { describe, expect, it } from 'vitest'
import { open, passphraseVerifier, seal } from './crypto'

describe('secret sealing', () => {
  it('round-trips text, unicode included', async () => {
    const sealed = await seal('pässwörd 🔑')
    expect(await open(sealed, sealed.fragment)).toBe('pässwörd 🔑')
    expect(sealed.ciphertext).not.toContain('pässwörd')
    expect(sealed.salt).toBeUndefined()
  })

  it('fails with the wrong key', async () => {
    const sealed = await seal('x')
    const other = await seal('y')
    await expect(open(sealed, other.fragment)).rejects.toThrow()
  })

  it('needs both the fragment and the passphrase', async () => {
    const sealed = await seal('x', 'correct horse')
    expect(await open(sealed, sealed.fragment, 'correct horse', sealed.salt)).toBe('x')
    await expect(open(sealed, sealed.fragment, 'wrong', sealed.salt)).rejects.toThrow()
    await expect(open(sealed, sealed.fragment)).rejects.toThrow()
  })

  it('derives the same verifier the sender stored, and it is not the key', async () => {
    const sealed = await seal('x', 'pw')
    expect(await passphraseVerifier('pw', sealed.salt as string)).toBe(sealed.verifier)
    expect(await passphraseVerifier('nope', sealed.salt as string)).not.toBe(sealed.verifier)
  })
})
