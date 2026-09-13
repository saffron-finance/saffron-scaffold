import {useState} from 'react'
import type {Address,Hex} from 'viem'
import {Modal,ModalTitle} from '../host/ui'
import {useVaultPosition} from '../host/useVaultPosition'
import {ErrorText,FinePrint,PrimaryAction,QuietButton,Row,Stack} from './styles'
import type {Deployment} from './model'

/** Review the connected funder's own variable-side withdrawal. Pausing a
 * program does not cancel a started vault or unlock its committed premium. */
export function CampaignWithdrawalModal({account,row,onClose}:{account:Address;row:Deployment;onClose:()=>void}){
  const flow=useVaultPosition(account,row.id,'campaign-withdraw'),[hash,setHash]=useState('')
  const control=flow.context?.deployment?.programControl??row.programControl
  const close=()=>{if(!flow.busy)onClose()}
  return <Modal isOpen contentLabel='Withdraw from vault' onRequestClose={close} shouldCloseOnOverlayClick={!flow.busy}
    contentStyle={{padding:'20px 24px 26px',maxWidth:560,width:'calc(100vw - 32px)',boxSizing:'border-box'}}>
    <Stack data-campaign-withdrawal={row.id}>
      <Row><ModalTitle style={{margin:0}}>Withdraw from vault</ModalTitle><QuietButton aria-label='Close campaign withdrawal' disabled={flow.busy} onClick={close}>×</QuietButton></Row>
      <b>{row.snapshot.display.pair} · {row.snapshot.durationSeconds/86400} days</b>
      <FinePrint>Program: <b>{control?.state??'Checking…'}</b>. Withdrawal requires a paused or closed program and confirmation in your wallet.</FinePrint>
      <ul style={{paddingLeft:18,margin:0,fontSize:13,lineHeight:1.5,overflowWrap:'anywhere'}}>
        <li>Receiving wallet: {account}</li>
        <li>Vault: <a style={{color:'#d286ff'}} href={'https://robinhoodchain.blockscout.com/address/'+row.plan.vault} target='_blank' rel='noreferrer'>{row.plan.vault}</a></li>
        <li>Network: Robinhood. Wallet network gas applies.</li>
      </ul>
      {flow.completed?<b role='status'>Campaign withdrawal confirmed.</b>:flow.quote?<>
        {flow.quote.phase==='premium'?<>
          <Row><span>Unused premium returned to you</span><b data-withdrawal-amount>{flow.amountLabel(0)} {flow.quote.tokens[0].symbol}</b></Row>
          <FinePrint>This withdraws all unused premium owned by your wallet. The vault is not started. Removing funding can make it unavailable for the user’s deposit.</FinePrint>
        </>:<>
          <Row><span>Your variable-side shares</span><b data-withdrawal-amount>{flow.amountLabel(0)} bearer units</b></Row>
          <FinePrint>The vault has matured. This burns your variable-side shares and returns your share of LP fees in {flow.quote.snapshot.token0.symbol} / {flow.quote.snapshot.token1.symbol}. The vault calculates the payout when the transaction executes; the committed premium is not returned.</FinePrint>
        </>}
        <FinePrint>This cannot withdraw another wallet’s funding or the user’s LP position.</FinePrint>
      </>:!flow.error&&<FinePrint role='status'>Checking program and withdrawal availability…</FinePrint>}
      {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
      {flow.pending?<Stack>
        <FinePrint>A wallet action needs confirmation. Recover it before submitting another withdrawal.</FinePrint>
        {flow.pending.hash&&<a href={'https://robinhoodchain.blockscout.com/tx/'+flow.pending.hash} target='_blank' rel='noreferrer'>View withdrawal transaction ↗</a>}
        <label>Transaction hash (if the wallet response was lost)<input aria-label='Recover withdrawal transaction hash' value={hash} onChange={e=>setHash(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}/></label>
        <PrimaryAction disabled={flow.busy||(!flow.pending.hash&&!/^0x[0-9a-fA-F]{64}$/.test(hash))} onClick={()=>void flow.recover(hash?hash as Hex:undefined)}>{flow.busy?'Confirming wallet action…':'Check withdrawal transaction'}</PrimaryAction>
      </Stack>:!flow.completed?<>
        <QuietButton disabled={flow.busy} onClick={()=>void flow.refresh()}>Refresh withdrawal</QuietButton>
        <PrimaryAction disabled={flow.busy||!flow.quote||Boolean(flow.quote.blocked)} onClick={()=>void flow.advance()}>{flow.busy?'Confirming wallet action…':flow.quote?.action.label??'Withdraw from vault'}</PrimaryAction>
      </>:<PrimaryAction disabled={flow.busy} onClick={close}>Done</PrimaryAction>}
    </Stack>
  </Modal>
}
