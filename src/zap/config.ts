import type { Address } from 'viem'

import type { ZapSupportedChainId } from './types'

/**
 * Trusted addresses copied from `feat/zap-frontend-lifi` after its onchain
 * verification. Keeping them static means a quote response cannot choose its
 * own executor or approval spender.
 */
export interface ZapChainConfig {
  router: Address
  quoter: Address
  lifiExecutor: Address
  lifiApproval: Address
}

export const ZAP_CHAIN_CONFIG: Record<ZapSupportedChainId, ZapChainConfig> = {
  1: {
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    lifiExecutor: '0xd9B2Da9C45b118e4e93A004FB1452bCDB6cC0E88',
    lifiApproval: '0x68E1Acfa805dcA813116Ed6507E01c38D44318f0',
  },
  42161: {
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    lifiExecutor: '0x2dfaDAB8266483beD9Fd9A292Ce56596a2D1378D',
    lifiApproval: '0x5741A7FfE7c39Ca175546a54985fA79211290b51',
  },
  4663: {
    router: '0xCaf681a66D020601342297493863E78C959E5cb2',
    quoter: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
    lifiExecutor: '0x464fC28B9CbC1781286c8626B6E925275c8C14F1',
    lifiApproval: '0xfb3973800ADf5B997E910F2DD90158924370612A',
  },
}

/** Same-chain quotes are short-lived because their calldata embeds live sizing. */
export const ZAP_QUOTE_MAX_AGE_MS = 30_000
export const TICK_BAND_SAME_CHAIN = 25
export const ZAP_MAX_SLIPPAGE_BPS = 500

export function isZapSupportedChainId(chainId: number): chainId is ZapSupportedChainId {
  return chainId === 1 || chainId === 42161 || chainId === 4663
}
