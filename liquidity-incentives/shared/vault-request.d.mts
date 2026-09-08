import type { Address, Hash } from 'viem'
export interface IncentiveRequestTerms {
  id: string; chainId: number; poolAddress: Address
  token0: { address: Address; symbol: string; decimals: number }
  token1: { address: Address; symbol: string; decimals: number }
  durationDays: number; capacityUsd: number; aprPercent: number; depositUsd: string
  slippageBps?: number; feeTier?: number; range: 'full'
  quote: { cashcatAmount: number; quoteAmount: number; rewardUsd: number; rewardCashcat: number
    cashcatUsd: number; quoteTokenUsd: number; quotePerCashcat: number; quotedAt: string }
}
export interface RequestPayment { asset: 'USDC' | 'ETH'; amountRaw: string; quoteId: string }
export interface RequestDetails { version?: 3; chain: string; depositToken: string; pair: string; depositAmount: string; kind?: 'incentive'; incentive?: IncentiveRequestTerms }
export interface PaidRequest extends RequestDetails { wallet: Address; recipient: Address; paymentTxHash: Hash; signature?: `0x${string}`; payment?: RequestPayment }
export const REQUEST_PAYMENT: Readonly<{ chainId: number; chainLabel: string; token: Address; tokenSymbol: string; tokenDecimals: number; amount: string }>
export function validDetails(value: unknown): value is RequestDetails
export function validAddress(value: unknown): value is Address
export function requestMessage(value: PaidRequest): string
export function canonicalIncentive(value: IncentiveRequestTerms): IncentiveRequestTerms
export function validRequestPayment(value: unknown): value is RequestPayment
