import { type FixedVault } from '../fixedVaults/model'

/** Production API snapshot used only by the zero-RPC GitHub Pages preview. */
export const FIXED_MOCK_CAPTURED_AT = Date.parse('2026-09-03T14:43:39.366Z')

const ETHEREUM = {
  chainKey: 'ethereum' as const,
  chainId: 1,
  chainLabel: 'Ethereum',
  explorer: 'https://etherscan.io',
}

const USDC = {
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as const,
  symbol: 'USDC',
  decimals: 6,
  priceUsd: 0.9999,
}

const WTAO = {
  address: '0x77e06c9eccf2e797fd462a92b6d7642ef85b0a44' as const,
  symbol: 'WTAO',
  decimals: 9,
  priceUsd: 222.8568257893827,
}

const WTAO_POOL = {
  address: '0xf763Bb342eB3d23C02ccB86312422fe0c1c17E94' as const,
  tick: -15044,
  tickSpacing: 200,
  sqrtPriceX96: 37344029619420158655343886336n,
}

const fixture: FixedVault[] = [
  {
    ...ETHEREUM,
    address: '0xca40dfefe98c6435cf21a33b187f8c3b14574d26',
    adapterAddress: '0xaf48d67d7dbb093fd4a410f96a92fc801f7ffe2f',
    durationSecs: 1209600,
    fixedSideCapacity: 1722781529n,
    claimTokenSupply: 0n,
    variableDeposited: 17413698n,
    variableAsset: { ...USDC, capacity: 17413698n },
    token0: {
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      symbol: 'WBTC',
      decimals: 8,
      priceUsd: 79507.4,
    },
    token1: USDC,
    pool: {
      address: '0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35',
      tick: 66788,
      tickSpacing: 60,
      sqrtPriceX96: 2234037538273236105852360721492n,
    },
    minTick: 65700,
    maxTick: 67800,
    apr: 0.09136873257944671,
    fixedRate: 0.003504554126334942,
    usdLiquidityValue: 4968380000n,
    isOutOfRange: false,
  },
  {
    ...ETHEREUM,
    address: '0x4875ea7a0d4d0ae1b70bbedd8d398a74e6bf697d',
    adapterAddress: '0xa93f998d8ddbb5b9c88952da1731e8f4678e75e1',
    durationSecs: 1209600,
    fixedSideCapacity: 202554030147n,
    claimTokenSupply: 0n,
    variableDeposited: 500000000000000000n,
    variableAsset: {
      address: '0xb753428af26e81097e7fd17f40c88aaa3e04902c',
      symbol: 'SFI',
      decimals: 18,
      priceUsd: 183.45968545085543,
      capacity: 500000000000000000n,
    },
    token0: WTAO,
    token1: USDC,
    pool: WTAO_POOL,
    minTick: -14600,
    maxTick: -12600,
    apr: 0.26831427265799845,
    fixedRate: 0.010291506348525967,
    usdLiquidityValue: 8913160000n,
    isOutOfRange: true,
  },
  {
    ...ETHEREUM,
    address: '0xc12ce4c8d0070c467e0ac3c914becf98fa362476',
    adapterAddress: '0x4d92edde43bd7eb5930951a0cfd80924346270ad',
    durationSecs: 1209600,
    fixedSideCapacity: 101199329993n,
    claimTokenSupply: 0n,
    variableDeposited: 47331506n,
    variableAsset: { ...USDC, capacity: 47331506n },
    token0: WTAO,
    token1: USDC,
    pool: WTAO_POOL,
    minTick: -14600,
    maxTick: -12600,
    apr: 0.2770788783379347,
    fixedRate: 0.0106276830047427,
    usdLiquidityValue: 4453160000n,
    isOutOfRange: true,
  },
  {
    ...ETHEREUM,
    address: '0x216f78536269657eb5c0ba883560b2e83289bcd1',
    adapterAddress: '0x5794524f2fdb424e1b4f6f46fea0c908a1893abc',
    durationSecs: 1209600,
    fixedSideCapacity: 9481149377n,
    claimTokenSupply: 0n,
    variableDeposited: 10739726n,
    variableAsset: { ...USDC, capacity: 10739726n },
    token0: WTAO,
    token1: USDC,
    pool: WTAO_POOL,
    minTick: -15800,
    maxTick: -11400,
    apr: 0.3068556201687718,
    fixedRate: 0.011769804609213164,
    usdLiquidityValue: 912390000n,
    isOutOfRange: false,
  },
  {
    ...ETHEREUM,
    address: '0x55e5289f9874288de7e97f662182b7d4238bd461',
    adapterAddress: '0xcaeb381be64fb95eee80728a95913d7c810f7e35',
    durationSecs: 2592000,
    fixedSideCapacity: 18961516967n,
    claimTokenSupply: 0n,
    variableDeposited: 46032000n,
    variableAsset: { ...USDC, capacity: 46032000n },
    token0: WTAO,
    token1: USDC,
    pool: WTAO_POOL,
    minTick: -15800,
    maxTick: -11400,
    apr: 0.30689976127582613,
    fixedRate: 0.0252246379130816,
    usdLiquidityValue: 1824700000n,
    isOutOfRange: false,
  },
]

export function loadMockFixedVaults(): FixedVault[] {
  return fixture.map((vault) => ({
    ...vault,
    variableAsset: { ...vault.variableAsset },
    token0: { ...vault.token0 },
    token1: { ...vault.token1 },
    pool: { ...vault.pool },
  }))
}
