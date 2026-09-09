import { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, stringToHex } from 'viem'
import { REQUEST_PAYMENT } from '../shared/vault-request.mjs'

export const RECIPIENT = '0x2222222222222222222222222222222222222222'
export const BLOCK_HASH = `0x${'ab'.repeat(32)}`
export const HASH = `0x${'12'.repeat(32)}`
const topic = (address) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`

/** Canonical JSON-RPC fixtures: no public RPC or funded wallet is involved. */
export function paymentFixture(wallet, hash = HASH, input) {
  const data = input ?? encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [RECIPIENT, 2_000_000n] })
  const transfer = decodeFunctionData({ abi: erc20Abi, data })
  const tx = { hash, from: wallet, to: REQUEST_PAYMENT.token, input: data, value: '0x0',
    blockHash: BLOCK_HASH, blockNumber: '0x64', transactionIndex: '0x0', nonce: '0x0', gas: '0x10000', gasPrice: '0x1', type: '0x0' }
  const receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash: BLOCK_HASH, blockNumber: '0x64',
    from: wallet, to: REQUEST_PAYMENT.token, status: '0x1', cumulativeGasUsed: '0x100', gasUsed: '0x100',
    effectiveGasPrice: '0x1', type: '0x0', contractAddress: null, logsBloom: `0x${'00'.repeat(256)}`,
    logs: [{ address: REQUEST_PAYMENT.token, data: `0x${transfer.args[1].toString(16).padStart(64, '0')}`,
      topics: [keccak256(stringToHex('Transfer(address,address,uint256)')), topic(wallet), topic(transfer.args[0])],
      transactionHash: hash, transactionIndex: '0x0', blockHash: BLOCK_HASH, blockNumber: '0x64', logIndex: '0x0', removed: false }] }
  const block = { hash: BLOCK_HASH, number: '0x64', transactions: [],
    timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16) }
  const rpc = async (method) => {
    if (method === 'eth_chainId') return '0xa4b1'
    if (method === 'eth_blockNumber') return '0x65'
    if (method === 'eth_getTransactionByHash') return tx
    if (method === 'eth_getTransactionReceipt') return receipt
    if (method === 'eth_getBlockByNumber') return block
    throw new Error(`Unexpected fixture method: ${method}`)
  }
  return { tx, receipt, block, rpc }
}
