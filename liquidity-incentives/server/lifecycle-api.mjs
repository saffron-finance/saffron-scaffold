import { json, readRequest, RequestError } from './vault-requests.mjs'
import { validAddress } from '../shared/vault-request.mjs'
import { CHAIN_ID, FACTORY } from '../shared/vault-lifecycle.mjs'

/** Native lifecycle HTTP boundary. Creation/funding only enqueue approved work;
 * there is intentionally no signer, calldata, shell command, or redirect here.
 */
export function createLifecycleHandler({ database, auth, service, signer, basePath = '' }) {
  const root = basePath + '/vault-requests'
  let started = Date.now(), attempts = 0
  return async (req, res, pathname) => {
    const suffix = pathname.startsWith(root) ? pathname.slice(root.length) : ''
    const operation = /^\/admin\/([A-Z0-9]{12})\/(create|fund)$/.exec(suffix)
    const context = /^\/([A-Z0-9]{12})\/deposit-context$/.exec(suffix)
    if (!operation && !context && !['/operator/challenge','/operator/login','/operator/session','/admin/requests'].includes(suffix)) return false
    try {
      if (!database || !auth || !service) throw new RequestError(503, 'Native vault service is unavailable.')
      if (Date.now() - started > 60_000) { started = Date.now(); attempts = 0 }
      if (++attempts > 180) throw new RequestError(429, 'Too many lifecycle requests. Retry shortly.')
      if (context) {
        if (req.method !== 'GET') throw new RequestError(405, 'GET only.')
        const wallet = new URL(req.url, 'http://localhost').searchParams.get('wallet')
        if (!validAddress(wallet)) throw new RequestError(400, 'Connect the requesting wallet.')
        json(res, 200, await service.context(context[1], wallet)); return true
      }
      if (req.method === 'GET' && suffix === '/operator/session') {
        const session = auth.session(req)
        json(res, 200, { wallet: session.wallet, csrf: session.csrf, expiresAt: new Date(session.expires).toISOString() }); return true
      }
      if (req.method === 'GET' && suffix === '/admin/requests') {
        auth.session(req)
        const rows = await database.list({ chainId: CHAIN_ID, admin: true })
        json(res, 200, { data: await Promise.all(rows.map(row => service.decorate(row, true))),
          ...await service.status(), chainId: CHAIN_ID, factory: FACTORY, refreshedAt: Date.now() }); return true
      }
      if (req.method !== 'POST') throw new RequestError(405, 'POST only.')
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new RequestError(415, 'JSON required.')
      const body = await readRequest(req)
      if (suffix === '/operator/challenge') { json(res, 200, auth.challenge(req, body.wallet)); return true }
      if (suffix === '/operator/login') { json(res, 200, await auth.login(req, res, body)); return true }
      if (!operation) throw new RequestError(404, 'Not found.')
      const operator = auth.session(req, { mutation: true })
      if (!validAddress(signer)) throw new RequestError(503, 'The local deployer signer is not configured.')
      if (operation[2] === 'create') {
        await database.lifecycle.approveCreation({ requestId: operation[1], expectedDigest: body.termsDigest,
          signer, operator: operator.wallet, resume: body.resume === true, sizingReview: body.sizingReview })
      } else {
        await database.lifecycle.approveFunding(operation[1], operator.wallet, body.termsDigest, body.maximumRaw)
      }
      json(res, 200, { success: true, ...(await database.lifecycle.summary(operation[1], true)) })
    } catch (error) {
      const known = [400,401,403,404,405,409,415,429,503].includes(error.status)
      json(res, known ? error.status : 503, { error: known ? error.message : 'Vault service unavailable. Saved requests and jobs are retained.' })
    }
    return true
  }
}
