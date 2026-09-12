import type { Hex } from 'viem'
export type Payment={quote:any;recoverySecret:Hex;sent:boolean;hash?:Hex;nonce?:number;deploymentId?:string;updatedAt?:number;resolutionState?:string;status:'prepared'|'submitting'|'submitted'|'confirming'|'accepted'|'needs_attention'|'confirmed_unpaid'|'abandoned'|'refunded'}
export type CheckoutDraft={requestKey:string;wallet:string;programId:string;amountUsd:string;recoverySecret:Hex;admission?:{id:string;state:string;expiresAt:string}}
export type Payments={revision:number;activeId:string|null;records:Record<string,Payment>;draft?:CheckoutDraft|null}
export function paymentRecordsKey(wallet:string):string
export function nextPaymentNonce(records:Record<string,Payment>,latest:number,pending:number):number
export function retryPaymentNonce(payment:Payment,latest:number,pending:number,now?:number):number
export function readPayments(storage:Pick<Storage,'getItem'>,wallet:string):Payments
export function savePayment(storage:Pick<Storage,'getItem'|'setItem'>,wallet:string,expected:Payments,payment:Payment,options?:{active?:boolean}):Payments
export function saveCheckoutDraft(storage:Pick<Storage,'getItem'|'setItem'>,wallet:string,expected:Payments,draft:CheckoutDraft|null):Payments

export function selectPayment(storage:Storage,wallet:string,expected:Payments,id?:string|null):Payments
