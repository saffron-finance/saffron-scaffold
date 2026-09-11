/** Price a new legacy transaction with one current base fee of headroom.
 * Some rollups return eth_gasPrice equal to the base fee; using it verbatim can
 * make a transaction inadmissible before the first broadcast. Existing signed
 * bytes must never be repriced here. Caller enforces the aggregate gas budget.
 * A configured ceiling is a hard limit, not permission to silently drop margin.
 */
export function legacyGasPrice({ suggested, baseFee = 0n, maximum }) {
  const quote = BigInt(suggested), base = BigInt(baseFee), limit = BigInt(maximum)
  if (quote <= 0n || base < 0n || limit <= 0n) throw new Error('Invalid legacy gas policy input.')
  const price = (quote > base ? quote : base) + base
  if (price > limit) throw new Error('Gas price headroom exceeds the configured operator budget.')
  return price
}
