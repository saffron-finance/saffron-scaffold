import { isAddress,zeroAddress } from 'viem'
import { fault,integer } from '../shared/incentives.mjs'

export function creationFeeRecipient(value){
  const recipient=typeof value==='string'?value.trim():''
  if(!recipient)throw fault(503,'The ETH creation-fee recipient is not configured.')
  if(!isAddress(recipient)||recipient.toLowerCase()===zeroAddress)
    throw fault(503,'The ETH creation-fee recipient is invalid.')
  return recipient.toLowerCase()
}

/** Copy the campaign's fixed native ETH amount. Issued quotes keep their original
 * amount and recipient, even if the operator later changes campaign settings.
 * Legacy campaigns without an explicit amount cannot issue new payment terms. */
export function quoteCreationFee(recipient,amountWei){
  recipient=creationFeeRecipient(recipient)
  try{integer(amountWei,{positive:true})}catch{throw fault(503,'This campaign needs a fixed ETH request fee.')}
  return {asset:'ETH',recipient,amountWei}
}
