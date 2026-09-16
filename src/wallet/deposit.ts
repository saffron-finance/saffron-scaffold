import { parseUnits, type Address, type Hash } from 'viem'
import { walletClient, walletPublicClient, ensureChain } from './wallet'
import { CHAINS } from '../chain/chains'
import { type VariableVault } from '../chain/vaults'

// Variable-side deposit, matching UniV3Vault.deposit exactly:
//   deposit(uint256 amount, uint256 side=1 VARIABLE, bytes deployCapitalData)
// deployCapitalData = '0x' → minAmount 0 (accept any). The contract itself caps `amount` to the
// remaining capacity and requires the vault has NOT started, so we only ever call this on Raising
// vaults. The token must be approved for the vault first (safeTransferFrom).
const erc20 = [
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

const vaultDepositAbi = [
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }], outputs: [] },
] as const

const VARIABLE_SIDE = 1n

export type DepositStep = 'switch-chain' | 'checking' | 'approving' | 'approve-confirm' | 'depositing' | 'deposit-confirm' | 'done'

export interface DepositResult {
  hash: Hash
}

// amountRaw is the already-parsed on-chain amount (caller caps it to remaining capacity + validates).
export async function depositVariable(
  v: VariableVault,
  amountHuman: string,
  account: Address,
  onStep: (s: DepositStep) => void,
): Promise<DepositResult> {
  const chainDef = CHAINS.find((c) => c.key === v.chainKey)
  if (!chainDef) throw new Error(`Unknown chain ${v.chainKey}`)
  if (v.isStarted || v.earningsSettled) throw new Error('This vault is no longer open for deposits.')

  const amount = parseUnits(amountHuman, v.variableAssetDecimals)
  if (amount <= 0n) throw new Error('Enter an amount greater than 0.')

  onStep('switch-chain')
  await ensureChain(chainDef.chain)

  const pub = walletPublicClient(chainDef.chain)
  const wc = walletClient()

  onStep('checking')
  const [balance, allowance] = (await Promise.all([
    pub.readContract({ address: v.variableAsset, abi: erc20, functionName: 'balanceOf', args: [account] }),
    pub.readContract({ address: v.variableAsset, abi: erc20, functionName: 'allowance', args: [account, v.vault] }),
  ])) as [bigint, bigint]
  if (balance < amount) throw new Error(`Insufficient ${v.variableAssetSymbol} balance in your wallet.`)

  if (allowance < amount) {
    onStep('approving')
    const approveHash = await wc.writeContract({
      account,
      chain: chainDef.chain,
      address: v.variableAsset,
      abi: erc20,
      functionName: 'approve',
      args: [v.vault, amount],
    })
    onStep('approve-confirm')
    const approval = await pub.waitForTransactionReceipt({ hash: approveHash })
    // A mined revert is not an approval; never continue to the deposit send.
    if (approval.status !== 'success') throw new Error('Token approval reverted. No deposit was sent.')
  }

  onStep('depositing')
  const hash = await wc.writeContract({
    account,
    chain: chainDef.chain,
    address: v.vault,
    abi: vaultDepositAbi,
    functionName: 'deposit',
    args: [amount, VARIABLE_SIDE, '0x'],
  })
  onStep('deposit-confirm')
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Deposit reverted. Check the transaction before trying again.')
  onStep('done')
  return { hash }
}
