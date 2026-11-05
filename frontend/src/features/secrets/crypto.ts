/** Everything sensitive happens here, in the browser. The server gets ciphertext, an IV and, with a
 *  passphrase, a salt and a verifier. The key travels in the URL fragment, which is never sent. */
const PBKDF2_ROUNDS = 600_000

export const cryptoAvailable = () => typeof crypto !== 'undefined' && Boolean(crypto.subtle)

type Bytes = Uint8Array<ArrayBuffer>

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function fromBase64(text: string): Bytes {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length))

/** Half the stretched passphrase joins the encryption key; the other half only proves knowledge of
 *  it, so the server can refuse a wrong passphrase before spending a view. */
async function stretch(passphrase: string, salt: Bytes) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, material, 512))
  const verifier = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bits.slice(32))))
  return { keyPart: bits.slice(0, 32), verifier }
}

async function aesKey(fragmentKey: Bytes, keyPart?: Bytes) {
  let raw = fragmentKey
  if (keyPart) {
    const joined = new Uint8Array(fragmentKey.length + keyPart.length)
    joined.set(fragmentKey)
    joined.set(keyPart, fragmentKey.length)
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', joined))
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export interface Sealed { ciphertext: string; iv: string; salt?: string; verifier?: string; fragment: string }

export async function seal(text: string, passphrase?: string): Promise<Sealed> {
  const fragmentKey = random(32)
  const iv = random(12)
  const salt = passphrase ? random(16) : undefined
  const stretched = passphrase && salt ? await stretch(passphrase, salt) : undefined
  const key = await aesKey(fragmentKey, stretched?.keyPart)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    salt: salt && toBase64(salt),
    verifier: stretched?.verifier,
    fragment: toBase64(fragmentKey),
  }
}

export async function passphraseVerifier(passphrase: string, salt: string) {
  return (await stretch(passphrase, fromBase64(salt))).verifier
}

export async function open(payload: { ciphertext: string; iv: string }, fragment: string, passphrase?: string, salt?: string | null): Promise<string> {
  const stretched = passphrase && salt ? await stretch(passphrase, fromBase64(salt)) : undefined
  const key = await aesKey(fromBase64(fragment), stretched?.keyPart)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(payload.iv) }, key, fromBase64(payload.ciphertext))
  return new TextDecoder().decode(plain)
}
