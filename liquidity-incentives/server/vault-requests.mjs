import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeFunctionData, erc20Abi, formatUnits, keccak256, stringToHex, verifyMessage } from 'viem'
import { REQUEST_PAYMENT, requestMessage, validAddress, validDetails, canonicalIncentive, validRequestPayment } from '../shared/vault-request.mjs'
import { createFeeService, PaymentQuoteExpiredError } from './request-fees.mjs'
import { adminListMessage } from '../shared/request-admin.mjs'
import { depositCents } from '../shared/vault-sizing.mjs'

const TRANSFER_TOPIC = keccak256(stringToHex('Transfer(address,address,uint256)'))
const AMOUNT = 2_000_000n
const HASH = /^0x[0-9a-fA-F]{64}$/

/** Expected errors carry only bounded, operator-independent public messages. */
export class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/** Return JSON with no caching; never expose the queue or upstream RPC details. */
export function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Consume at most 16 KiB, including malformed or never-completing submissions. */
export async function readRequest(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 16_384) throw new RequestError(413, 'Request is too large.')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new RequestError(400, 'Invalid request.') }
}

/**
 * Verify the actual mined transfer, not merely its input. A token may return
 * false without reverting, so a matching USDC Transfer event is also required.
 * The RPC dependency is operator-owned and injectable for deterministic tests.
 */
export async function verifyPayment(body, rpc) {
  const [chainId, tx, receipt, head] = await Promise.all([
    rpc('eth_chainId', []),
    rpc('eth_getTransactionByHash', [body.paymentTxHash]),
    rpc('eth_getTransactionReceipt', [body.paymentTxHash]),
    rpc('eth_blockNumber', []),
  ])
  if (chainId !== '0xa4b1') throw new RequestError(503, 'Payment verification is temporarily unavailable.')
  if (!tx || !receipt || receipt.status !== '0x1') throw new RequestError(402, 'Payment is not confirmed successfully. Check the transaction before retrying.')
  const same = (a, b) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()
  if (!same(tx.hash, body.paymentTxHash) || !same(receipt.transactionHash, body.paymentTxHash)
    || !HASH.test(receipt.blockHash ?? '') || !same(tx.blockHash, receipt.blockHash)
    || tx.blockNumber !== receipt.blockNumber) throw new RequestError(402, 'Payment receipt does not match the transaction.')
  if (!same(tx.from, body.wallet)) throw new RequestError(402, 'Payment wallet does not match.')
  const asset = body.version === 3 ? body.payment.asset : 'USDC'
  if (asset === 'ETH') {
    if (!same(tx.to, body.recipient) || BigInt(tx.value ?? '0x0') !== BigInt(body.payment.amountRaw)
      || !['', '0x'].includes(tx.input)) throw new RequestError(402, 'ETH payment must match the quoted amount and recipient without contract calls.')
  } else {
  if (!same(tx.to, REQUEST_PAYMENT.token)) throw new RequestError(402, 'Payment token does not match.')
  let transfer
  try { transfer = decodeFunctionData({ abi: erc20Abi, data: tx.input }) }
  catch { throw new RequestError(402, 'Invalid USDC transfer.') }
  if (tx.input.length !== 138 || transfer.functionName !== 'transfer'
    || !same(transfer.args[0], body.recipient) || transfer.args[1] !== AMOUNT
    || BigInt(tx.value ?? '0x0') !== 0n) throw new RequestError(402, 'Payment must transfer exactly 2 USDC to the configured recipient.')
  const topicAddress = (topic, address) => same(topic, `0x${'0'.repeat(24)}${address.slice(2)}`)
  const paid = receipt.logs?.some((log) => !log.removed && same(log.address, REQUEST_PAYMENT.token)
    && log.topics?.length === 3 && same(log.topics[0], TRANSFER_TOPIC)
    && topicAddress(log.topics[1], body.wallet) && topicAddress(log.topics[2], body.recipient)
    && /^0x[0-9a-fA-F]{64}$/.test(log.data) && BigInt(log.data) === AMOUNT)
  if (!paid) throw new RequestError(402, 'Confirmed USDC transfer event was not found.')
  }
  if (BigInt(head) < BigInt(receipt.blockNumber) + 1n) throw new RequestError(402, 'Payment needs two Arbitrum block confirmations. Retry shortly without paying again.')
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
  if (!same(block?.hash, receipt.blockHash)) throw new RequestError(402, 'Payment block is not canonical. Retry shortly.')
  return { ...receipt, blockTimestamp: block.timestamp }
}

/**
 * Serialize writes for this single-process service. Only ENOENT means an empty
 * queue; corrupt or unreadable state must never be overwritten. fsync + atomic
 * rename preserve a complete file across a restart. Identical retries return
 * the original receipt instead of charging again or creating duplicate work.
 */
export function createRequestStore(storePath) {
  let writes = Promise.resolve()
  return (record) => {
    const operation = writes.catch(() => {}).then(async () => {
      await mkdir(dirname(storePath), { recursive: true, mode: 0o700 })
      let records
      try { records = JSON.parse(await readFile(storePath, 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') records = []; else throw error }
      if (!Array.isArray(records)) throw new Error('Invalid store')
      const existing = records.find((row) => row.paymentTxHash === record.paymentTxHash)
      if (existing) {
        if (existing.requestDigest !== record.requestDigest) throw new RequestError(409, 'This payment already belongs to a different request.')
        return { record: existing, created: false }
      }
      records.push(record)
      const temporary = `${storePath}.${process.pid}.tmp`
      const file = await open(temporary, 'w', 0o600)
      try { await file.writeFile(`${JSON.stringify(records, null, 2)}\n`); await file.sync() }
      finally { await file.close() }
      await rename(temporary, storePath)
      // Windows does not support opening/fsyncing a directory through Node.
      // The file itself is synced on every platform before the atomic rename.
      if (process.platform !== 'win32') {
        const directory = await open(dirname(storePath), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
      return { record, created: true }
    })
    writes = operation
    return operation
  }
}

/** Own only GET config and POST submission beneath the existing app prefix. */
export function createVaultRequestHandler({ recipient, storePath, rpc, basePath, database, adminOwner, adminAllowed, lifecycle }) {
  const receivingAddress = validAddress(recipient) ? recipient.toLowerCase() : null
  const save = database ? (record) => database.save(record) : createRequestStore(storePath)
  const fees = database ? createFeeService({ rpc, database, recipient: receivingAddress }) : null
  const challenges = new Map()
  let windowStart = 0
  let attempts = 0
  const list = async options => Promise.all((await database.list(options)).map(row => lifecycle ? lifecycle.decorate(row, options.admin) : row))
  return async (req, res, pathname) => {
    const route = `${basePath}/vault-requests`
    if (pathname !== route && ![`${route}/config`, `${route}/quote`, `${route}/my`, `${route}/handoff`, `${route}/admin/challenge`, `${route}/admin/list`].includes(pathname)) return false
    if (pathname.endsWith('/config')) {
      let healthy = true, eth = null
      if (database) try { await database.health() } catch { healthy = false }
      if (healthy && fees) try { eth = await fees.price() } catch { /* USDC remains usable when ETH pricing is unavailable. */ }
      json(res, req.method === 'GET' ? 200 : 405, req.method === 'GET'
        ? { ...REQUEST_PAYMENT, enabled: Boolean(receivingAddress) && healthy, recipient: receivingAddress, confirmations: 2,
          ethAvailable: Boolean(eth), ethUsdRaw: eth?.ethUsdRaw ?? null, ethAmountRaw: eth?.amountRaw ?? null,
          ethPriceUpdatedAt: eth?.updatedAt ?? null, feeAssets: database ? ['USDC','ETH'] : ['USDC'] }
        : { error: 'GET only.' })
      return true
    }
    try {
      if (pathname === `${route}/my`) {
        if (req.method !== 'GET') throw new RequestError(405, 'GET only.')
        const wallet = new URL(req.url, 'http://localhost').searchParams.get('wallet')
        if (!validAddress(wallet)) throw new RequestError(400, 'A valid wallet address is required.')
        if (!database) throw new RequestError(503, 'Pending requests are unavailable.')
        json(res, 200, { success: true, data: await list({ wallet }), inquiries: await database.inquiries(wallet), timestamp: new Date().toISOString() })
        return true
      }
      if (pathname === `${route}/handoff`) {
        throw new RequestError(410, 'Legacy handoff retired. Use the native requests page.')
      }
      if (req.method !== 'POST') throw new RequestError(405, 'POST only.')
      if (!pathname.includes('/admin/') && !receivingAddress) throw new RequestError(503, 'Vault request payments are not configured.')
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new RequestError(415, 'JSON required.')
      if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); attempts = 0 }
      if (++attempts > 60) throw new RequestError(429, 'Too many requests. Retry in a minute without paying again.')
      const body = await readRequest(req)
      if (pathname.startsWith(`${route}/admin/`)) {
        if (!database || (!adminAllowed && !adminOwner) || !validAddress(body.wallet) || ![1,42161,4663].includes(body.chainId)) throw new RequestError(400, 'Invalid admin request.')
        const permitted = adminAllowed ? await adminAllowed(body.wallet, body.chainId)
          : (await adminOwner(body.chainId))?.toLowerCase() === body.wallet.toLowerCase()
        if (!permitted) throw new RequestError(403, 'Connect an allowed test-operator wallet.')
        for (const [id, challenge] of challenges) if (Date.parse(challenge.expiresAt) < Date.now()) challenges.delete(id)
        if (pathname.endsWith('/challenge')) {
          if (challenges.size >= 100) throw new RequestError(429, 'Retry admin access shortly.')
          const challenge = { wallet: body.wallet.toLowerCase(), chainId: body.chainId, nonce: randomUUID(), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }
          challenges.set(challenge.nonce, challenge)
          json(res, 200, challenge); return true
        }
        const challenge = challenges.get(body.nonce)
        if (!challenge || challenge.wallet !== body.wallet.toLowerCase() || challenge.chainId !== body.chainId) throw new RequestError(401, 'Request a fresh admin proof.')
        let verified = false
        try { verified = await verifyMessage({ address: body.wallet, message: adminListMessage(challenge), signature: body.signature }) } catch {}
        if (!verified) throw new RequestError(401, 'Invalid admin proof.')
        challenges.delete(body.nonce)
        json(res, 200, { success: true, data: await list({ chainId: body.chainId, admin: true }), timestamp: new Date().toISOString() })
        return true
      }
      if (!receivingAddress) throw new RequestError(503, 'Vault request payments are not configured.')
      if (pathname.endsWith('/quote')) {
        if (!fees || !validAddress(body.wallet) || !['USDC','ETH'].includes(body.asset)) throw new RequestError(400, 'Invalid fee quote request.')
        if (!validDetails(body.details)) throw new RequestError(400, 'Review valid request terms before requesting a fee quote.')
        if (body.details.kind === 'incentive' && !depositCents(body.details.incentive.depositUsd)) {
          throw new RequestError(400, 'Use a deposit of at least $0.01 with no fractions of a cent.')
        }
        if (body.details.kind === 'incentive') await database.assertActiveProgram(body.details.incentive)
        json(res, 200, await fees.quote(body.wallet, body.asset, body.details)); return true
      }
      if (!validDetails(body) || !validAddress(body.wallet) || !validAddress(body.recipient)
        || body.recipient.toLowerCase() !== receivingAddress || typeof body.paymentTxHash !== 'string' || !HASH.test(body.paymentTxHash)
        || typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)
        || (body.version === 3 && !validRequestPayment(body.payment))) throw new RequestError(400, 'Invalid request.')
      const message = requestMessage(body)
      let authorized = false
      try { authorized = await verifyMessage({ address: body.wallet, message, signature: body.signature }) }
      catch { /* Malformed signatures are an authentication failure, not a server error. */ }
      if (!authorized) throw new RequestError(401, 'Sign the request with the wallet that paid.')
      if (body.version === 3 && !fees) throw new RequestError(503, 'Payment quotes are unavailable.')
      const receipt = await verifyPayment(body, rpc)
      if (body.version === 3) {
        try { await fees.verifyQuote(body, receipt.blockTimestamp) }
        catch (error) {
          throw new RequestError(402, error instanceof PaymentQuoteExpiredError
            ? error.message : 'Payment quote does not match this request.')
        }
      }
      const payment = body.version === 3 ? body.payment : null
      const record = {
        id: `VR-${body.paymentTxHash.slice(2).toUpperCase()}`,
        status: 'paid_waiting_for_vault', createdAt: new Date().toISOString(),
        wallet: body.wallet.toLowerCase(), chain: body.chain,
        depositToken: body.depositToken.trim(), pair: body.pair.trim(), depositAmount: body.depositAmount,
        ...(body.kind === 'incentive' ? { kind: 'incentive', incentive: canonicalIncentive(body.incentive) } : {}),
        recipient: receivingAddress, paymentChainId: REQUEST_PAYMENT.chainId,
        paymentAsset: payment?.asset ?? 'USDC',
        paymentToken: payment?.asset === 'ETH' ? '0x0000000000000000000000000000000000000000' : REQUEST_PAYMENT.token,
        paymentAmount: payment ? formatUnits(BigInt(payment.amountRaw), payment.asset === 'ETH' ? 18 : 6) : REQUEST_PAYMENT.amount,
        ...(payment ? { version: 3, payment, signature: body.signature } : {}),
        paymentTxHash: body.paymentTxHash.toLowerCase(), paymentBlock: receipt.blockNumber,
        paymentBlockHash: receipt.blockHash, requestDigest: keccak256(stringToHex(message)),
      }
      const result = await save(record)
      json(res, result.created ? 201 : 200, { id: result.record.id, status: result.record.status })
    } catch (error) {
      json(res, error instanceof RequestError || error.status === 409 ? error.status : 503,
        { error: error instanceof RequestError || error.status === 409 ? error.message : 'Request could not be verified or saved. Retry without paying again.' })
    }
    return true
  }
}
