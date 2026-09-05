import { type ChainKey } from '../chain/chains'

export function saffronVaultUrl(chain: ChainKey, vault: string, side: 'fixed' | 'variable' = 'variable'): string {
  return `https://beta.saffron.finance/network/${chain}/vault/${vault}/${side}`
}
