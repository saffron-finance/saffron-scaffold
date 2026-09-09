import type { Address } from 'viem'
export interface IncentivePair {
  id: string; revision: number; chainId: 4663; pool: Address; feeTier: number
  token0: { address: Address; symbol: string; decimals: number }
  token1: { address: Address; symbol: string; decimals: number }
  active: boolean
}
export interface IncentiveProgram {
  id: string; revision: number; pairId: string; apr: number; days: number; capacityUsd: number
  sortOrder: number; isNew: boolean; active: boolean
}
export interface ProgramAdminProof {
  wallet: Address; chainId: number; action: 'list' | 'save-pair' | 'save-program'
  payload: IncentivePair | IncentiveProgram | null; nonce: string; expiresAt: string
}
export function validPair(value: unknown): value is IncentivePair
export function validProgram(value: unknown): value is IncentiveProgram
export function canonicalPair(value: IncentivePair): IncentivePair
export function canonicalProgram(value: IncentiveProgram): IncentiveProgram
export function programAdminMessage(value: ProgramAdminProof): string
