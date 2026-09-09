import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { administerCatalog, type AdminCatalog } from '../host/useIncentivePrograms'
import { validPair, validProgram, type IncentivePair, type IncentiveProgram } from '../../shared/incentive-program.mjs'
import { ErrorText, FinePrint, QuietButton, Row, Stack } from './styles'

/** An optional admin disclosure keeps catalog maintenance out of the offer list. */
export function ProgramAdmin({ account, onConnect }: { account: Address | null; onConnect: () => void }) {
  const [catalog, setCatalog] = useState<{ wallet: Address; data: AdminCatalog } | null>(null)
  const [pair, setPair] = useState<IncentivePair | null>(null)
  const [program, setProgram] = useState<IncentiveProgram | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState<string>()
  useEffect(() => { setCatalog(null); setPair(null); setProgram(null); setError(undefined); setSaved(undefined) }, [account])
  const current = catalog?.wallet === account ? catalog.data : null
  async function run(action: 'list' | 'save-pair' | 'save-program') {
    if (!account) { onConnect(); return }
    setBusy(true); setError(undefined); setSaved(undefined)
    try {
      const data = await administerCatalog(account, action, action === 'save-pair' ? pair : action === 'save-program' ? program : null)
      setCatalog({ wallet: account, data }); setPair(null); setProgram(null)
      if (action !== 'list') setSaved('Catalog saved. Updated offers are now available.')
    } catch (cause) { setError(cause instanceof Error ? cause.message.split('\n')[0] : 'The catalog could not be saved.') }
    finally { setBusy(false) }
  }
  const editPair = (value: IncentivePair) => { setProgram(null); setPair(structuredClone(value)); setSaved(undefined) }
  const editProgram = (value: IncentiveProgram) => { setPair(null); setProgram(structuredClone(value)); setSaved(undefined) }
  return <Stack>
    <FinePrint>The Robinhood Chain factory-owner wallet can add, edit, or pause pairs and programs. Each action uses a free wallet signature.</FinePrint>
    <Row><QuietButton onClick={() => void run('list')} disabled={busy}>{busy ? 'Waiting for admin action…' : current ? 'Reload catalog' : 'Load incentive catalog'}</QuietButton></Row>
    {error && <ErrorText role='alert'>{error}</ErrorText>}
    {saved && <FinePrint role='status'>{saved}</FinePrint>}
    {current && <>
      <Row><b>Pairs</b><QuietButton disabled={busy} onClick={() => editPair({ id: '', revision: 0, chainId: 4663, pool: '0x', feeTier: 10000,
        token0: { address: '0x', symbol: '', decimals: 18 }, token1: { address: '0x', symbol: '', decimals: 18 }, active: true })}>Add pair</QuietButton></Row>
      <Items>{current.pairs.map(value => <li key={value.id}><span>{value.token0.symbol} / {value.token1.symbol} · {value.feeTier / 10000}%{!value.active && ' · Paused'}</span>
        <QuietButton disabled={busy} aria-label={`Edit pair ${value.id}`} onClick={() => editPair(value)}>Edit</QuietButton></li>)}</Items>
      <Row><b>Programs</b><QuietButton disabled={busy || !current.pairs.length} onClick={() => editProgram({ id: '', revision: 0,
        pairId: current.pairs.find(value => value.active)?.id ?? current.pairs[0].id, apr: 0, days: 1, capacityUsd: 0,
        sortOrder: current.programs.length, isNew: false, active: true })}>Add program</QuietButton></Row>
      <Items>{current.programs.map(value => <li key={value.id}><span>{value.id} · {value.apr.toLocaleString()}% · {value.days} days{!value.active && ' · Paused'}</span>
        <QuietButton disabled={busy} aria-label={`Edit program ${value.id}`} onClick={() => editProgram(value)}>Edit</QuietButton></li>)}</Items>
      {pair && <Editor onSubmit={(event: FormEvent) => { event.preventDefault(); if (validPair(pair)) void run('save-pair') }}>
        <b>{pair.revision ? 'Edit pair' : 'Add pair'}</b>
        <Fields>
          <Field label='Pair ID'><input required pattern='[a-z0-9][a-z0-9-]{0,79}' value={pair.id} disabled={busy || pair.revision > 0} onChange={e => setPair({ ...pair, id: e.target.value })} /></Field>
          <Field label='Pool address'><input required value={pair.pool} disabled={busy} onChange={e => setPair({ ...pair, pool: e.target.value as Address })} /></Field>
          <Field label='Pool fee'><select value={pair.feeTier} disabled={busy} onChange={e => setPair({ ...pair, feeTier: Number(e.target.value) })}>
            {[100,500,3000,10000].map(fee => <option key={fee} value={fee}>{fee / 10000}%</option>)}</select></Field>
          {(['token0', 'token1'] as const).map((key, index) => <TokenFields key={key}>
            <legend>{index === 0 ? 'Yield token' : 'Paired token'}</legend>
            <Field label={`${index === 0 ? 'Yield' : 'Paired'} token address`}><input required value={pair[key].address} disabled={busy} onChange={e => setPair({ ...pair, [key]: { ...pair[key], address: e.target.value as Address } })} /></Field>
            <Field label={`${index === 0 ? 'Yield' : 'Paired'} token symbol`}><input required maxLength={20} pattern='[A-Za-z0-9._\-]+' value={pair[key].symbol} disabled={busy} onChange={e => setPair({ ...pair, [key]: { ...pair[key], symbol: e.target.value } })} /></Field>
            <Field label={`${index === 0 ? 'Yield' : 'Paired'} token decimals`}><input required type='number' min={0} max={18} value={pair[key].decimals} disabled={busy} onChange={e => setPair({ ...pair, [key]: { ...pair[key], decimals: Number(e.target.value) } })} /></Field>
          </TokenFields>)}
        </Fields>
        <Check><input type='checkbox' checked={pair.active} disabled={busy} onChange={e => setPair({ ...pair, active: e.target.checked })} />Pair active</Check>
        <FinePrint>Robinhood Chain, full range. Pausing a pair hides all its programs. Pool tokens, decimals, and fee are checked on-chain when saving.</FinePrint>
        <Row><QuietButton type='button' disabled={busy} onClick={() => setPair(null)}>Cancel edit</QuietButton><QuietButton type='submit' disabled={busy || !validPair(pair)}>Save pair</QuietButton></Row>
      </Editor>}
      {program && <Editor onSubmit={(event: FormEvent) => { event.preventDefault(); if (validProgram(program)) void run('save-program') }}>
        <b>{program.revision ? 'Edit program' : 'Add program'}</b>
        <Fields>
          <Field label='Program ID'><input required pattern='[a-z0-9][a-z0-9-]{0,79}' value={program.id} disabled={busy || program.revision > 0} onChange={e => setProgram({ ...program, id: e.target.value })} /></Field>
          <Field label='Program pair'><select value={program.pairId} disabled={busy} onChange={e => setProgram({ ...program, pairId: e.target.value })}>{current.pairs.map(value => <option key={value.id} value={value.id}>{value.token0.symbol} / {value.token1.symbol} ({value.id}){!value.active && ' · Paused'}</option>)}</select></Field>
          <Field label='APR (%)'><input required type='number' min={0.01} max={100000} step={0.01} value={program.apr} disabled={busy} onChange={e => setProgram({ ...program, apr: Number(e.target.value) })} /></Field>
          <Field label='Duration (days)'><input required type='number' min={1} max={3650} value={program.days} disabled={busy} onChange={e => setProgram({ ...program, days: Number(e.target.value) })} /></Field>
          <Field label='Proposed capacity (USD)'><input required type='number' min={0.01} max={1e12} step={0.01} value={program.capacityUsd} disabled={busy} onChange={e => setProgram({ ...program, capacityUsd: Number(e.target.value) })} /></Field>
          <Field label='Display order'><input required type='number' min={-100000} max={100000} value={program.sortOrder} disabled={busy} onChange={e => setProgram({ ...program, sortOrder: Number(e.target.value) })} /></Field>
        </Fields>
        <Check><input type='checkbox' checked={program.active} disabled={busy} onChange={e => setProgram({ ...program, active: e.target.checked })} />Program active</Check>
        <Check><input type='checkbox' checked={program.isNew} disabled={busy} onChange={e => setProgram({ ...program, isNew: e.target.checked })} />Show NEW badge</Check>
        <FinePrint>Programs advertise proposed terms. Saving a row does not fund a vault. Paid receipts keep their original terms.</FinePrint>
        <Row><QuietButton type='button' disabled={busy} onClick={() => setProgram(null)}>Cancel edit</QuietButton><QuietButton type='submit' disabled={busy || !validProgram(program)}>Save program</QuietButton></Row>
      </Editor>}
    </>}
  </Stack>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <FieldLabel>{label}{children}</FieldLabel> }
const Items = styled.ul`margin:0;padding:0;list-style:none;li{display:flex;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid #ffffff12;padding:6px 0;overflow-wrap:anywhere}span{min-width:0}button{flex-shrink:0;white-space:nowrap}`
const Editor = styled.form`display:flex;flex-direction:column;gap:18px;border-top:1px solid #ffffff25;padding-top:20px;`
const Fields = styled.div`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;@media(max-width:650px){grid-template-columns:minmax(0,1fr)}`
const FieldLabel = styled.label`display:flex;flex-direction:column;gap:8px;font-size:12px;min-width:0;
  input,select{width:100%;min-width:0;box-sizing:border-box;border:1px solid #7775;border-radius:6px;padding:10px;font:inherit;background:${p => p.theme.colors.background.base};color:${p => p.theme.colors.text.primary}}
  input:focus-visible,select:focus-visible{outline:2px solid ${p => p.theme.colors.accent.gold}}
  input:disabled{opacity:.6}`
const TokenFields = styled.fieldset`min-width:0;display:flex;flex-direction:column;gap:12px;border:1px solid #7775;border-radius:6px;padding:12px;legend{padding:0 4px}`
const Check = styled.label`display:flex;align-items:center;gap:10px;font-size:13px;input{width:16px;height:16px}`
