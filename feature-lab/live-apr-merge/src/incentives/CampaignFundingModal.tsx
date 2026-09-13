import { useState } from 'react'
import type { Address,Hex } from 'viem'
import { Modal,ModalTitle } from '../host/ui'
import { useVaultPosition } from '../host/useVaultPosition'
import { ErrorText,FinePrint,PrimaryAction,QuietButton,Row,Stack } from './styles'
import type { Deployment } from './model'

/** Explicit admin-wallet review, retained outside the queue's filtered rows so
 * a successful onchain deposit cannot unmount its own receipt/recovery dialog. */
export function CampaignFundingModal({account,row,onClose}:{account:Address;row:Deployment;onClose:()=>void}){
  const flow=useVaultPosition(account,row.id,'fund'),[hash,setHash]=useState('')
  const snapshot=flow.context?.snapshot??row.observation
  const close=()=>{if(!flow.busy)onClose()}
  return <Modal isOpen contentLabel='Fund campaign' onRequestClose={close} shouldCloseOnOverlayClick={!flow.busy}
    contentStyle={{padding:'20px 24px 26px',maxWidth:560,width:'calc(100vw - 32px)',boxSizing:'border-box'}}>
    <Stack data-campaign-funding={row.id}>
      <Row><ModalTitle style={{margin:0}}>Fund campaign</ModalTitle><QuietButton aria-label='Close campaign funding' disabled={flow.busy} onClick={close}>×</QuietButton></Row>
      <b>{row.snapshot.display.pair} · {row.snapshot.durationSeconds/86400} days</b>
      <FinePrint>From your connected admin wallet on Robinhood. ETH is needed separately for network gas.</FinePrint>
      <ul style={{paddingLeft:18,margin:0,fontSize:13,lineHeight:1.5,overflowWrap:'anywhere'}}>
        <li>Funding wallet: {account}</li>
        <li>Vault: <a style={{color:'#d286ff'}} href={'https://robinhoodchain.blockscout.com/address/'+row.plan.vault} target='_blank' rel='noreferrer'>{row.plan.vault}</a></li>
        {snapshot?.variableAsset&&<li>Reward token: {snapshot.variableSymbol} · {snapshot.variableAsset}</li>}
      </ul>
      {flow.completed?<b role='status'>Campaign funding confirmed.</b>:flow.quote?<>
        <Row><span>Remaining premium</span><b data-funding-amount>{flow.amountLabel(0)} {flow.quote.tokens[0].symbol}</b></Row>
        <FinePrint>This funds the vault’s variable side. Your wallet receives the variable-side bearer tokens and its entitlement to LP fees; this is not your LP deposit.</FinePrint>
        <FinePrint>Approve the displayed token amount, then confirm “Fund campaign” separately in your wallet.</FinePrint>
      </>:!flow.error&&<FinePrint role='status'>Loading current funding amount…</FinePrint>}
      {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
      {flow.pending?<Stack>
        <FinePrint>A submitted wallet action needs confirmation. Check it before making another payment.</FinePrint>
        {flow.pending.hash&&<a href={'https://robinhoodchain.blockscout.com/tx/'+flow.pending.hash} target='_blank' rel='noreferrer'>View funding transaction ↗</a>}
        <label>Transaction hash (if the wallet response was lost)<input aria-label='Recover funding transaction hash' value={hash} onChange={e=>setHash(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}/></label>
        <PrimaryAction disabled={flow.busy||(!flow.pending.hash&&!/^0x[0-9a-fA-F]{64}$/.test(hash))} onClick={()=>void flow.recover(hash?hash as Hex:undefined)}>{flow.busy?'Confirming wallet action…':'Check funding transaction'}</PrimaryAction>
      </Stack>:!flow.completed?<>
        <QuietButton disabled={flow.busy} onClick={()=>void flow.refresh()}>Refresh funding amount</QuietButton>
        <PrimaryAction disabled={flow.busy||!flow.quote||Boolean(flow.quote.blocked)} onClick={()=>void flow.advance()}>{flow.busy?'Confirming wallet action…':flow.quote?.action.label??'Fund campaign'}</PrimaryAction>
      </>:<PrimaryAction disabled={flow.busy} onClick={close}>Done</PrimaryAction>}
    </Stack>
  </Modal>
}
