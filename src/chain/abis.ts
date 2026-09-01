// Minimal ABIs, copied verbatim (relevant fragments) from Saffron's official ABIs in
// saffron-fixed-income/packages/core/src/abis/{VaultFactory,Vault}.json. Read-only surface only.

export const factoryAbi = [
  {
    inputs: [],
    name: 'nextVaultId',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ type: 'uint256' }],
    name: 'vaultInfo',
    outputs: [
      { name: 'creatorAddress', type: 'address' },
      { name: 'addr', type: 'address' },
      { name: 'adapterAddress', type: 'address' },
      { name: 'vaultTypeId', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

export const vaultAbi = [
  { inputs: [], name: 'variableAsset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'variableBearerToken', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'claimToken', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'variableSideCapacity', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'fixedSideCapacity', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'duration', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'endTime', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isStarted', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'earningsSettled', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'feeBps', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'adapter', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  {
    anonymous: false,
    inputs: [
      { indexed: false, name: 'amounts', type: 'uint256[]' },
      { indexed: false, name: 'side', type: 'uint256' },
      { indexed: true, name: 'user', type: 'address' },
    ],
    name: 'FundsDeposited',
    type: 'event',
  },
] as const

export const erc20Abi = [
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const
