import { formatUnits } from 'viem'
import styled from 'styled-components'
import type { RequestFlow } from '../host/useRequestFlow'
import { ErrorText, FinePrint, Label, QuietButton, Row, Token } from './styles'
import { TokenIcon } from './TokenIcon'
import { tokenAmount, usd } from './model'

/** Fee-only asset choice. Balances and USD ordering are supplied by the host. */
export function RequestFeeSelector({ flow, connected }: { flow: RequestFlow; connected: boolean }) {
  return <section aria-label='Request fee payment'>
    <Row><Label>Pay request fee with</Label><QuietButton type='button' onClick={flow.refreshBalances}
      disabled={!connected || flow.balanceLoading || flow.busy}>Refresh</QuietButton></Row>
    <Choices role='group' aria-label='Fee asset'>
      {(['USDC', 'ETH'] as const).map(asset => {
        const raw = flow.balances[asset]
        const balance = raw === undefined ? undefined : Number(formatUnits(raw, asset === 'ETH' ? 18 : 6))
        const dollars = balance === undefined ? undefined : asset === 'USDC' ? balance
          : flow.config?.ethUsdRaw ? balance * Number(flow.config.ethUsdRaw) / 1e8 : undefined
        return <Choice key={asset} type='button' $selected={flow.selectedAsset === asset}
          aria-pressed={flow.selectedAsset === asset} onClick={() => flow.setAsset(asset)}
          disabled={flow.busy || Boolean(flow.pending) || (asset === 'ETH' && !flow.config?.ethAvailable)}>
          <Token><TokenIcon symbol={asset} size={24} /><b>{asset}</b></Token>
          <Balance>{!connected ? 'Connect wallet' : flow.balanceLoading ? 'Loading balance…'
            : balance === undefined ? 'Balance unavailable' : `${tokenAmount(balance)} ${asset}`}</Balance>
          {dollars !== undefined && <FinePrint>{usd(dollars)}</FinePrint>}
        </Choice>
      })}
    </Choices>
    <FinePrint>Arbitrum balances, automatically selected by USD value. You can choose either asset.</FinePrint>
    {flow.balances.error && <ErrorText role='alert'>{flow.balances.error}</ErrorText>}
    {connected && !flow.pending && !flow.balanceLoading && flow.config?.enabled && !flow.canPay &&
      <FinePrint>Keep enough {flow.selectedAsset} for the fee and ETH for Arbitrum network gas.</FinePrint>}
  </section>
}

// Same compact two-choice treatment as fixed-income's deposit-method selector.
const Choices = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0;`
const Choice = styled.button<{ $selected: boolean }>`
  min-width:0;padding:14px;text-align:left;cursor:pointer;
  border:1px solid ${({ $selected, theme }) => $selected ? theme.colors.primary.base : theme.colors.border.base};
  border-radius:var(--radius-sm);background:${({ $selected, theme }) => $selected ? theme.colors.background.elevated : theme.colors.background.secondary};
  color:${({ theme }) => theme.colors.text.primary};
  &:hover:not(:disabled){border-color:${({ theme }) => theme.colors.primary.base}}
  &:disabled{cursor:not-allowed;opacity:.6}
`
const Balance = styled.span`display:block;font-size:12px;margin-top:8px;overflow-wrap:anywhere;`
