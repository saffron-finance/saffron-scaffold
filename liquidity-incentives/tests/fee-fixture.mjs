import { encodeAbiParameters } from 'viem'
import { ETH_USD_FEED, ARBITRUM_SEQUENCER_FEED } from '../server/request-fees.mjs'

/** Fresh, deterministic $2,000 ETH/USD and healthy sequencer, without chain writes. */
export function feeRpc(fixture, options = {}) {
  return async (method, params) => {
    if (method === 'eth_call') {
      const address = params[0].to.toLowerCase()
      if (params[0].data === '0x313ce567') return encodeAbiParameters([{ type: 'uint8' }], [8])
      const time = BigInt(Math.floor(Date.now() / 1000))
      const sequencer = address === ARBITRUM_SEQUENCER_FEED.toLowerCase()
      if (sequencer || address === ETH_USD_FEED.toLowerCase()) return encodeAbiParameters(
        [{ type: 'uint80' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint80' }],
        [1n, sequencer ? (options.sequencerDown ? 1n : 0n) : BigInt(options.price ?? 2000_00000000n),
          time - 7200n, options.stale ? time - 7200n : time - 10n, 1n])
    }
    return fixture.rpc(method, params)
  }
}
