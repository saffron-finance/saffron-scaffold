import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { protectedRpc, READ_METHODS } from '../../../worker/protected-config.mjs'
import { anvilBinary } from '../../../tests/anvil.mjs'
import { digest } from '../../../shared/incentives.mjs'
import { executeOne, validateInputs, sendSaved } from './operator-execution.mjs'
const require = createRequire(new URL('../../../package.json', import.meta.url))
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts')

/** Exercise the exact live execution implementation against actual factory code
 * in a private Anvil fork. Only a fresh disposable fixture key is loaded. This
 * tests interrupted recovery, lost-send-response handling and permanent replay
 * protection; the original exact-EOA simulation is a separate evidence file. */
async function main() {
  if (process.argv.length !== 3) throw new Error('Supply an operator-owned read-only fork config file.')
  const sourceConfig = JSON.parse(await readFile(process.argv[2], 'utf8'))
  const original = JSON.parse(await readFile(new URL('./job.json', import.meta.url)))
  const simulation = JSON.parse(await readFile(new URL('./simulation.json', import.meta.url)))
  const upstream = await protectedRpc({ ...sourceConfig, readOnly: true })
  let upstreamBroadcasts = 0
  const blockedUpstreamMethods = {}
  const bridge = createServer(async (req, res) => {
    try {
      let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 65536) throw new Error() }
      const body = JSON.parse(text), entries = Array.isArray(body) ? body : [body]
      const denied = entries.filter(entry => !READ_METHODS.has(entry.method))
      if (denied.length) {
        for (const entry of denied) {
          blockedUpstreamMethods[entry.method] = (blockedUpstreamMethods[entry.method] ?? 0) + 1
          if (/send|sign/i.test(entry.method)) upstreamBroadcasts++
        }
        throw new Error() // Unknown reads stay rejected; the allowlist is unchanged.
      }
      const result = await Promise.all(entries.map(async entry => {
        try { return { jsonrpc: '2.0', id: entry.id, result: await upstream(entry.method, entry.params ?? []) } }
        catch { return { jsonrpc: '2.0', id: entry.id, error: { code: -32000, message: 'Read-only fork upstream unavailable' } } }
      }))
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(Array.isArray(body) ? result : result[0]))
    } catch { res.writeHead(403); res.end('Read-only fork request rejected') }
  })
  bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening')
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
  let child
  try {
    child = spawn(anvilBinary(), ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '4663',
      '--fork-url', `http://127.0.0.1:${bridge.address().port}`, '--fork-block-number', simulation.forkBlockNumber,
      '--no-storage-caching', '--block-time', '1', '--silent'], { stdio: 'ignore' })
    let processError = false; child.on('error', () => { processError = true })
    const rpc = async (method, params = []) => {
      const response = await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30000) })
      const body = await response.json()
      if (!response.ok || body.error) throw new Error('Local test RPC failed: ' + method)
      return body.result
    }
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      assert(!processError && child.exitCode === null, 'Anvil must start')
      try { ready = BigInt(await rpc('eth_chainId')) === 4663n } catch {}
      if (!ready) await delay(100)
    }
    assert(ready)
    // The fixture key never leaves this process; it has no real-chain funds.
    const fixture = privateKeyToAccount(generatePrivateKey())
    await rpc('anvil_setBalance', [fixture.address, '0xde0b6b3a7640000'])
    await rpc('evm_setNextBlockTimestamp', [Math.floor(Date.now() / 1000)])
    await rpc('evm_mine')
    const directory = await mkdtemp(join(tmpdir(), 'saffron-operator-execution-test-'))
    const config = { ...sourceConfig, enabled: true, signerAddress: fixture.address, stateDirectory: directory }
    const job = structuredClone(original.job); job.signer = fixture.address.toLowerCase()
    job.plan_hash = digest({ authorization: job.authorization, snapshot: job.snapshot, plan: job.plan, signer: job.signer })
    // This synthetic permit fixture is ONLY for recovery tests. The independent
    // simulation.json contains the true funded-EOA fork simulation used live.
    const fixtureSimulation = { ...simulation, signer: job.signer, planHash: job.plan_hash,
      checkedAt: new Date().toISOString(), fixtureOnly: true }
    let signatures = 0, sends = 0
    const account = { address: fixture.address, signTransaction: async tx => { signatures++; return fixture.signTransaction(tx) } }
    const unstableRpc = async (method, params) => {
      if (method !== 'eth_sendRawTransaction') return rpc(method, params)
      const saved = JSON.parse(await readFile(directory + '/state.json', 'utf8'))
      assert(saved.journal.some(tx => tx.raw_tx === params[0]), 'Signed bytes must be on disk before every send')
      const hash = await rpc(method, params); sends++
      if (sends === 2) throw new Error('Injected response loss after local node accepted vault creation')
      return hash
    }
    await assert.rejects(executeOne({ job, config, simulation: fixtureSimulation, rpc: unstableRpc, account,
      onProgress: event => { if (event.state === 'confirmed' && event.step === 'create-adapter') throw new Error('Injected interruption') } }), /Injected interruption/)
    assert.equal(signatures, 1)
    const result = await executeOne({ job, config, simulation: fixtureSimulation, rpc: unstableRpc, account })
    assert.equal(result.state, 'created'); assert.equal(result.observation.positionWallet, '0x0000000000000000000000000000000000000000')
    assert.equal(result.observation.variableCapacity, '499999999999999999727')
    assert.equal(result.observation.duration, 259200); assert.equal(result.observation.isStarted, false)
    assert.equal(result.observation.variableSupply, '0'); assert.equal(result.observation.claimSupply, '0')
    assert.equal(signatures, 3); assert.equal(sends, 3)
    const replay = await executeOne({ job, config, simulation: fixtureSimulation, rpc: unstableRpc, account })
    assert.equal(replay.vault, result.vault); assert.equal(signatures, 3); assert.equal(sends, 3)
    const changed = structuredClone(job); changed.plan.premium = '500000000000000000000'
    assert.throws(() => validateInputs(changed, config, fixtureSimulation), /terms changed/)
    // A nonce consumed by an unknown transaction must stop without a send.
    let unknownSends = 0
    await assert.rejects(sendSaved({ tx: { hash: '0x' + 'ab'.repeat(32), nonce: 0 }, signer: fixture.address, confirmations: 2,
      rpc: async method => { if (method === 'eth_getTransactionReceipt') return null; if (method === 'eth_getTransactionCount') return '0x1'; unknownSends++; throw new Error() },
      persist: async () => {}, timeoutMs: 10, pollMs: 1 }), /Nonce consumed/)
    assert.equal(unknownSends, 0)
    console.log(JSON.stringify({ blockedUpstreamMethods, upstreamBroadcasts }))
    assert.equal(upstreamBroadcasts, 0)
    const evidence = { ok: true, checkedAt: new Date().toISOString(), localOnly: true, upstreamBroadcasts, liveSignerLoaded: false,
      cases: ['real factory creation with zero-address observer', 'fsynced bytes before send', 'resume after confirmed-adapter interruption',
        'lost vault-send response reconciles same hash', 'exact premium and duration', 'unfunded and unstarted final state',
        'completed replay signs and sends nothing', 'changed immutable terms rejected', 'unknown consumed nonce stops without send'],
      localSignatures: signatures, localSends: sends, blockedUpstreamMethods, forkBlockNumber: simulation.forkBlockNumber, fixtureVault: result.vault }
    await writeFile(directory + '/execution-test.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify({ ...evidence, evidenceDirectory: directory }))
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit') }
    bridge.closeAllConnections(); await new Promise(resolve => bridge.close(resolve))
  }
}
// Configuration parsing/provider exceptions can contain protected input. Keep
// the CLI failure generic; all successful evidence is explicitly public-only.
main().catch(() => { console.error('Read-only fork recovery test failed; no live signer was loaded. Check the reviewed fork configuration and local fixtures.'); process.exitCode = 1 })
