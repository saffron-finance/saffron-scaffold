import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { verifyMessage } from 'viem'
import { validAddress } from '../shared/vault-request.mjs'
import { adminSessionMessage, CHAIN_ID } from '../shared/vault-lifecycle.mjs'

const denied = message => Object.assign(new Error(message), { status: 401 })
const hash = text => createHash('sha256').update(text).digest('hex')

/** A server-owned operator policy replaces factory ownership for every admin action.
 * The session cookie is HttpOnly; a separate memory-only CSRF value protects writes.
 */
export function createOperatorAuth({ operators = [], origin, basePath = '', now = Date.now }) {
  const allowed = new Set(operators.filter(validAddress).map(value => value.toLowerCase()))
  const challenges = new Map(), sessions = new Map()
  const cookieName = 'saffron_operator_' + hash(basePath).slice(0, 8)
  const sessionOrigin = origin ? new URL(origin).origin : null
  function permitted(wallet, chainId = CHAIN_ID) { return chainId === CHAIN_ID && validAddress(wallet) && allowed.has(wallet.toLowerCase()) }
  function originCheck(req) {
    if (!sessionOrigin || req.headers.origin !== sessionOrigin) throw denied('Admin origin unavailable or mismatched.')
  }
  function prune() {
    for (const [key, value] of challenges) if (value.expires <= now()) challenges.delete(key)
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key)
  }
  return {
    permitted,
    challenge(req, wallet) {
      originCheck(req); prune()
      if (!permitted(wallet)) throw Object.assign(new Error('Connect an allowed test-operator wallet.'), { status: 403 })
      if (challenges.size >= 100) throw denied('Too many challenges. Retry shortly.')
      const proof = { origin: sessionOrigin, wallet: wallet.toLowerCase(), chainId: CHAIN_ID,
        nonce: randomUUID(), expiresAt: new Date(now() + 300_000).toISOString() }
      challenges.set(proof.nonce, { proof, expires: now() + 300_000 })
      return proof
    },
    async login(req, res, body) {
      originCheck(req); prune()
      const entry = challenges.get(body.nonce)
      if (!entry || !permitted(body.wallet) || entry.proof.wallet !== body.wallet.toLowerCase()) throw denied('Request a fresh operator challenge.')
      challenges.delete(body.nonce)
      let verified = false
      try { verified = await verifyMessage({ address: body.wallet, message: adminSessionMessage(entry.proof), signature: body.signature }) } catch {}
      if (!verified || entry.expires <= now()) throw denied('Invalid operator signature.')
      const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex')
      const session = { wallet: body.wallet.toLowerCase(), csrf, expires: now() + 30 * 60_000 }
      sessions.set(hash(token), session)
      res.setHeader('Set-Cookie', cookieName + '=' + token + '; HttpOnly; SameSite=Strict; Path=' + (basePath || '/') + '; Max-Age=1800' + (sessionOrigin.startsWith('https:') ? '; Secure' : ''))
      return { wallet: session.wallet, csrf, expiresAt: new Date(session.expires).toISOString() }
    },
    session(req, { mutation = false } = {}) {
      prune()
      const cookie = (req.headers.cookie ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))
      const token = cookie?.slice(cookieName.length + 1)
      const session = token && sessions.get(hash(token))
      if (!session || !permitted(session.wallet)) throw denied('Sign in as a test operator.')
      if (mutation) {
        originCheck(req)
        const supplied = String(req.headers['x-saffron-csrf'] ?? '')
        const left = Buffer.from(session.csrf), right = Buffer.from(supplied)
        if (left.length !== right.length || !timingSafeEqual(left, right)) throw denied('Reload the admin session before changing a vault.')
      }
      return session
    },
  }
}
