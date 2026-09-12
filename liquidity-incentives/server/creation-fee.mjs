import { isAddress,zeroAddress } from 'viem'
import { fault } from '../shared/incentives.mjs'
import { ceilDiv } from '../shared/liquidity-math.mjs'

export function creationFeeRecipient(value){
  const recipient=typeof value==='string'?value.trim():''
  if(!recipient)throw fault(503,'The ETH creation-fee recipient is not configured.')
  if(!isAddress(recipient)||recipient.toLowerCase()===zeroAddress)
    throw fault(503,'The ETH creation-fee recipient is invalid.')
  return recipient.toLowerCase()
}

/** Native ETH on Robinhood. A quote owns these values after it is issued. */
export function quoteCreationFee(recipient,eth,now=Date.now()){
  recipient=creationFeeRecipient(recipient)
  if(!/^\d+$/.test(eth?.priceRaw??'')||BigInt(eth.priceRaw)<=0n||!Number.isFinite(eth.checkedAt)
    ||now-eth.checkedAt>60_000||eth.checkedAt>now+5000)
    throw fault(503,'A fresh ETH/USD fee quote is unavailable.')
  return {usdCents:'200',asset:'ETH',recipient,amountWei:ceilDiv(2n*10n**36n,BigInt(eth.priceRaw)).toString(),
    ethPriceRaw:eth.priceRaw,checkedAt:eth.checkedAt}
}
