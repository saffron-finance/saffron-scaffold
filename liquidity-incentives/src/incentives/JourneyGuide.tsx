import { StepTitle } from '../host/ui'
import { QuietButton,Stack } from './styles'
import { OpsButtons,OpsCard,OpsGrid,OpsNote,OpsRow } from './operator-styles'

/** Real workflow guidance, not example campaign state or a simulated journey. */
export function StartupSteps({onNavigate}:{onNavigate:(path:string)=>void}){
  return <OpsCard aria-label='How to turn on paid requests'><h2>How to turn on paid requests</h2>
    <ol>
      <li><b>You — prepare the campaign.</b> Connect an allowlisted admin wallet, sign in, and configure the pool, duration, economics, and fixed ETH request fee. Arrange an external premium funder and refund payer.</li>
      <li><b>Server operator — start payment scanning.</b> Configure the keyless watcher for the same database, Robinhood RPC, watcher ID, and reviewed start block. Start it and wait for a recent canonical checkpoint. Keep its checkpoint across restarts.</li>
      <li><b>You + server operator — prepare the creator.</b> Use a dedicated creator wallet. Provide its key through protected server credentials, never chat or the browser. Supply Robinhood ETH for gas. The creator must use the same public signer and protocol settings as the API.</li>
      <li><b>Server operator — run and supervise creation.</b> Start the automatic creator service and verify its heartbeat. Check its logs and journal for failed or pending work. This page does not start a signer.</li>
      <li><b>You — open a staffed intake window.</b> In Administration, choose Automatic queue and open the window. Confirm Status says Paid requests enabled. Reviewed mode instead needs a separate execution for each accepted request; it is not automatic creation.</li>
      <li><b>You + external funder — verify delivery.</b> Make the first request with a different wallet from the fee recipient. Follow payment, creation, full premium funding, LP deposit, claim, and eventual withdrawal. The user wallet signs its own transactions.</li>
    </ol>
    <OpsButtons><QuietButton onClick={()=>onNavigate('/campaigns')}>Campaigns</QuietButton><QuietButton onClick={()=>onNavigate('/admin')}>Administration</QuietButton><QuietButton onClick={()=>onNavigate('/status')}>Status</QuietButton></OpsButtons>
    <details><summary>Server operator commands and restart rules</summary><p>After protected configuration is provisioned, the repository provides two separate runners. These commands are instructions, not browser actions.</p>
      <p><code>npm run worker:payments -- &lt;protected-payments-config&gt; --once</code><br/>Inspect one bounded scan first. Then run without <code>--once</code> under service supervision.</p>
      <p><code>npm run worker -- &lt;protected-creator-config&gt;</code><br/>This enables automatic transaction signing for accepted requests. The key belongs only in the separate creator process.</p>
      <p>The repository includes <code>saffron-payment-watcher.service</code> and <code>saffron-vault-creator.service</code> templates. Adapt paths and database roles before installing them; a template is not evidence that a service is installed.</p>
      <p>After a service failure: inspect its journal, correct the cause, restart the same service, and refresh Status. Never delete payment checkpoints or transaction journals. Pausing intake stops new quotes; it does not stop accepted work or erase payments.</p>
    </details>
  </OpsCard>
}

export function JourneyGuide({onNavigate}:{onNavigate:(path:string)=>void}){
  const stages=[['1 · Request','The user connects a wallet, selects a campaign and LP size, and pays the exact quoted ETH fee. This fee is fixed per campaign, not linked to ETH/USD.'],['2 · Create','The watcher verifies the payment. The separate creator deploys the adapter and vault, then initializes the saved terms.'],['3 · Fund premium','The external funder supplies the full required premium. Creation alone does not make a vault ready for an LP deposit.'],['4 · Deposit and claim','The user wallet approves and deposits the required LP assets, then claims the incentive. On-chain ownership controls these actions.'],['5 · Mature and withdraw','The position remains locked for the chosen term. At maturity, the user wallet withdraws through Portfolio.'],['If progress stops','Use Administration for saved requests, payment exceptions and refund review. Status explains service blockers. Preserve the original payment; do not pay again because a callback failed.']]
  return <Stack><OpsRow><StepTitle>Journey Guide</StepTitle><QuietButton onClick={()=>onNavigate('/status')}>Status</QuietButton></OpsRow><OpsNote>What happens at each stage, who performs it, and what must be ready first.</OpsNote><StartupSteps onNavigate={onNavigate}/><OpsGrid>{stages.map(([title,body])=><OpsCard key={title}><h2>{title}</h2><p>{body}</p></OpsCard>)}</OpsGrid></Stack>
}
