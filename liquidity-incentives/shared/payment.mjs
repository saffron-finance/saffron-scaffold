import { keccak256,stringToHex } from 'viem'

/** Public commitments; the recovery capability itself never enters transaction data. */
export const proofHash=value=>keccak256(stringToHex(value))
export const paymentData=quote=>keccak256(stringToHex('Saffron vault creation fee v1:'+quote.id+':'+quote.planHash+':'+quote.recoveryHash))
