import { randomUUID } from 'node:crypto'
import { decodeFunctionResult, encodeFunctionData, parseAbi, verifyMessage } from 'viem'
import { validAddress } from '../shared/vault-request.mjs'
import { canonicalPair, canonicalProgram, programAdminMessage, validPair, validProgram } from '../shared/incentive-program.mjs'
import { json, readRequest, RequestError } from './vault-requests.mjs'

const abi = parseAbi(['function token0() view returns (address)', 'function token1() view returns (address)',
  'function fee() view returns (uint24)', 'function decimals() view returns (uint8)'])

/** Verify operator-entered pool/token identities using only the configured Robinhood RPC. */
export async function verifyCatalogPair(pair, rpc) {
  if (await rpc('eth_chainId', []) !== '0x1237') throw new RequestError(503, 'Robinhood RPC is unavailable.')
  const block = await rpc('eth_blockNumber', [])
  const call = async (address, functionName) => decodeFunctionResult({ abi, functionName,
    data: await rpc('eth_call', [{ to: address, data: encodeFunctionData({ abi, functionName }) }, block]) })
  const [token0, token1, fee, decimals0, decimals1] = await Promise.all([
    call(pair.pool, 'token0'), call(pair.pool, 'token1'), call(pair.pool, 'fee'),
    call(pair.token0.address, 'decimals'), call(pair.token1.address, 'decimals'),
  ])
  const tokens = [token0.toLowerCase(), token1.toLowerCase()]
  if (!tokens.includes(pair.token0.address) || !tokens.includes(pair.token1.address)
    || fee !== pair.feeTier || decimals0 !== pair.token0.decimals || decimals1 !== pair.token1.decimals) {
    throw new RequestError(400, 'Pool tokens, fee tier, or token decimals do not match the chain.')
  }
}

export function createIncentiveProgramHandler({ database, adminOwner, adminAllowed, rpc, basePath = '', now = Date.now }) {
  const challenges = new Map()
  let windowStart = 0, attempts = 0
  return async (req, res, pathname) => {
    const route = `${basePath}/incentive-programs`
    if (pathname !== route && !pathname.startsWith(`${route}/`)) return false
    try {
      if (!database) throw new RequestError(503, 'Incentive programs are unavailable.')
      if (pathname === route) {
        if (req.method !== 'GET') throw new RequestError(405, 'GET only.')
        json(res, 200, { success: true, ...await database.catalog() }); return true
      }
      if (![`${route}/admin/challenge`, `${route}/admin/execute`].includes(pathname)) throw new RequestError(404, 'Not found.')
      if (req.method !== 'POST') throw new RequestError(405, 'POST only.')
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new RequestError(415, 'JSON required.')
      if (now() - windowStart > 60_000) { windowStart = now(); attempts = 0 }
      if (++attempts > 60) throw new RequestError(429, 'Too many admin requests. Retry shortly.')
      const body = await readRequest(req)
      if (!validAddress(body?.wallet)) throw new RequestError(400, 'Connect a valid admin wallet.')
      const permitted = adminAllowed ? await adminAllowed(body.wallet, 4663)
        : (await adminOwner(4663))?.toLowerCase() === body.wallet.toLowerCase()
      if (!permitted) throw new RequestError(403, 'Connect an allowed test-operator wallet.')
      for (const [nonce, proof] of challenges) if (Date.parse(proof.expiresAt) <= now()) challenges.delete(nonce)
      if (pathname.endsWith('/challenge')) {
        let payload
        if (body.action === 'list') payload = null
        else if (body.action === 'save-pair' && validPair(body.payload)) payload = canonicalPair(body.payload)
        else if (body.action === 'save-program' && validProgram(body.payload)) payload = canonicalProgram(body.payload)
        else throw new RequestError(400, 'Check the pair or program fields.')
        if (challenges.size >= 100) throw new RequestError(429, 'Retry admin access shortly.')
        const proof = { wallet: body.wallet.toLowerCase(), chainId: 4663, action: body.action, payload,
          nonce: randomUUID(), expiresAt: new Date(now() + 5 * 60_000).toISOString() }
        challenges.set(proof.nonce, proof)
        json(res, 200, proof); return true
      }
      const proof = challenges.get(body.nonce)
      if (!proof || proof.wallet !== body.wallet.toLowerCase()) throw new RequestError(401, 'Request a fresh admin signature.')
      let verified = false
      try { verified = await verifyMessage({ address: proof.wallet, message: programAdminMessage(proof), signature: body.signature }) } catch {}
      if (!verified) throw new RequestError(401, 'Invalid admin signature.')
      if (challenges.get(body.nonce) !== proof || Date.parse(proof.expiresAt) <= now()) throw new RequestError(401, 'Request a fresh admin signature.')
      challenges.delete(proof.nonce)
      if (proof.action === 'save-pair') {
        await verifyCatalogPair(proof.payload, rpc)
        await database.savePair(proof.payload, proof.wallet)
      } else if (proof.action === 'save-program') await database.saveProgram(proof.payload, proof.wallet)
      json(res, 200, { success: true, ...await database.catalog(true) })
    } catch (error) {
      const known = error instanceof RequestError || [400,409].includes(error.status)
      json(res, known ? error.status : 503, { error: known ? error.message : 'The catalog could not be loaded or saved. Retry shortly.' })
    }
    return true
  }
}
