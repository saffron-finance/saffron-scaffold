import { randomUUID } from 'node:crypto'
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem'

export const ETH_USD_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612'
export const ARBITRUM_SEQUENCER_FEED = '0xFdB631F5EE196F0ed6FAa767959853A9F217697D'
const oracleAbi = parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)', 'function decimals() view returns (uint8)'])

/** Round up by at most one wei; no floating-point currency conversion. */
export function ethFeeRaw(ethUsdRaw) {
  const price = BigInt(ethUsdRaw)
  if (price <= 0n) throw new Error('ETH price unavailable')
  return (200_000_000n * 10n ** 18n + price - 1n) / price
}

/** Read fresh Chainlink ETH/USD only while Arbitrum's sequencer is healthy. */
export function createFeeService({ rpc, database, recipient, now = Date.now }) {
  let cached
  async function price() {
    if (cached && now() - cached.readAt < 30_000) return cached
    const chain = await rpc('eth_chainId', [])
    if (chain !== '0xa4b1') throw new Error('Wrong fee chain')
    const call = async (address, functionName) => decodeFunctionResult({ abi: oracleAbi, functionName,
      data: await rpc('eth_call', [{ to: address, data: encodeFunctionData({ abi: oracleAbi, functionName }) }, 'latest']) })
    const [round, sequencer, decimals] = await Promise.all([
      call(ETH_USD_FEED, 'latestRoundData'), call(ARBITRUM_SEQUENCER_FEED, 'latestRoundData'), call(ETH_USD_FEED, 'decimals'),
    ])
    const seconds = BigInt(Math.floor(now() / 1000))
    if (decimals !== 8 || round[1] <= 0n || round[3] <= 0n || round[3] > seconds + 60n
      || seconds - round[3] > 3600n || round[4] < round[0]
      || sequencer[1] !== 0n || sequencer[2] <= 0n || seconds - sequencer[2] <= 3600n) {
      throw new Error('Fresh ETH pricing is unavailable')
    }
    cached = { ethUsdRaw: String(round[1]), amountRaw: String(ethFeeRaw(round[1])), readAt: now(), updatedAt: Number(round[3]) * 1000 }
    return cached
  }
  return {
    price,
    async quote(wallet, asset) {
      if (!['USDC', 'ETH'].includes(asset)) throw new Error('Unsupported fee asset')
      const current = asset === 'ETH' ? await price() : null
      const value = { id: randomUUID(), wallet: wallet.toLowerCase(), recipient: recipient.toLowerCase(), asset,
        amountRaw: asset === 'ETH' ? current.amountRaw : '2000000', ethUsdRaw: current?.ethUsdRaw ?? null,
        expiresAt: new Date(now() + 15 * 60_000).toISOString() }
      await database.putQuote(value)
      return value
    },
    async verifyQuote(body) {
      const quote = await database.getQuote(body.payment.quoteId)
      if (!quote || quote.wallet !== body.wallet.toLowerCase() || quote.recipient !== body.recipient.toLowerCase()
        || quote.asset !== body.payment.asset || quote.amount_raw !== body.payment.amountRaw) {
        throw new Error('Payment quote does not match this request')
      }
      // The browser refreshes expired quotes BEFORE requesting a transfer.
      // Once sent, its exact amount stays valid for recovery: a later price
      // change or expired display timer must never demand a second payment.
      return quote
    },
  }
}
