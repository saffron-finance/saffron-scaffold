import { defineChain, type Chain } from 'viem'


// Robinhood Chain is an Arbitrum-Orbit L2 (chain id 4663). viem has no built-in def, so we declare it.
// Native currency + explorer taken from Saffron's config / the public Blockscout instance.
export const robinhoodChain: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    // Optional explicitly public endpoint for adding this network to a wallet.
    default: { http: import.meta.env.VITE_WALLET_RPC_ROBINHOOD ? [import.meta.env.VITE_WALLET_RPC_ROBINHOOD] : [] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  // Multicall3 is deployed at the canonical address (verified on-chain). viem ships it for
  // mainnet/arbitrum but not for this custom chain, so we declare it to enable batched reads.
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})
