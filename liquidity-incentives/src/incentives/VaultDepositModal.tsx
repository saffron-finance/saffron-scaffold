import { useState } from 'react'
import { formatUnits, type Address, type Hex } from 'viem'
import { Modal, ModalTitle } from '../host/ui'
import { useVaultDeposit } from '../host/useVaultDeposit'
import { Action, ErrorText, FinePrint, QuietButton, Stack } from './styles'
import { VaultReview } from './VaultReview'

/** Uses the request form's shared second-page body, with fixed-only actions. */
export function VaultDepositModal({account,requestId,onClose}:{account:Address;requestId:string;onClose:()=>void}) {
  const flow=useVaultDeposit(account,requestId)
  const [hash,setHash]=useState('')
  const s=flow.quote?.snapshot
  return <Modal isOpen onRequestClose={onClose} shouldCloseOnOverlayClick={!flow.busy}
    contentStyle={{padding:'10px 28px 26px 28px'}}>
    <ModalTitle role='heading' aria-level={2}>Deposit into {requestId}</ModalTitle>
    <Stack>
      <QuietButton disabled={flow.busy} onClick={onClose} aria-label='Close vault deposit'>Close</QuietButton>
      {s && <VaultReview label='Vault deposit summary' bullets={<>
        <li><b>{flow.amountLabel(0)} {s.token0.symbol}</b> and <b>{flow.amountLabel(1)} {s.token1.symbol}</b> are the current LP amounts.</li>
        <li>LP lock: <b>{s.duration/86400} days</b>.</li>
        <li>Premium: <b>{formatUnits(BigInt(s.variableCapacity),s.variableDecimals)} {s.variableSymbol}</b> · fully funded by admin.</li>
        <li>Your position may suffer <b>impermanent loss</b>.</li>
        <li>No additional request fee. Wallet transactions require network gas.</li>
      </>} details={<>
        <p>Robinhood Chain · request {requestId}</p><p>Vault <code>{s.vault}</code></p>
        <p>Full range: {s.minTick} to {s.maxTick}. Token-spend buffer / slippage: 0.5%; transaction deadline: 5 minutes.</p>
        <p>The fixed deposit starts a fully funded vault. Premium is then claimable, not transferred by this deposit call.</p>
      </>} />}
      {!s&&!flow.error&&!flow.completed&&<FinePrint role='status'>Checking vault funding and LP amounts…</FinePrint>}
      {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
      {flow.completed?<><p role='status'>Fixed deposit confirmed. Check your request for the current vault status. Premium becomes claimable once the vault starts.</p><Action onClick={onClose}>Done</Action></>:flow.pending?<div>
        <p>Transaction recovery — no new transaction will be sent.</p>
        {flow.pending.hash?<p><a href={'https://robinhoodchain.blockscout.com/tx/'+flow.pending.hash} target='_blank' rel='noreferrer'>View transaction ↗</a></p>
          :<label>Transaction hash from your wallet<input aria-label='Recover transaction hash' value={hash} onChange={event=>setHash(event.target.value)} /></label>}
        <Action disabled={flow.busy||(!flow.pending.hash&&!/^0x[0-9a-fA-F]{64}$/.test(hash))} onClick={()=>void flow.recover(hash?hash as Hex:undefined)}>
          {flow.busy?'Checking transaction…':'Check transaction'}
        </Action>
      </div>:<>
        <QuietButton disabled={flow.busy} onClick={()=>void flow.refresh()}>Refresh amounts</QuietButton>
        <Action disabled={flow.busy||!flow.quote||Boolean(flow.quote?.blocked)} onClick={()=>void flow.advance()}>{flow.busy?'Confirming wallet action…':flow.quote?.action.label??'Deposit unavailable'}</Action>
      </>}
    </Stack>
  </Modal>
}
