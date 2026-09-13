import type { ReactNode } from 'react'
import styled from 'styled-components'
import { Modal } from './ui'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'

/** The new header uses local, code-native icons: no remote icon requests. */
export function HeaderIcon({ name }: { name: 'menu' | 'close' | 'wallet' | 'chevron' | 'arrow' | 'refresh' }) {
  const paths = { menu: 'M4 6h16M4 12h16M4 18h16', close: 'm6 6 12 12M6 18 18 6', wallet: 'M4 6h15v4M4 6V4h13v2M4 6v14h16V10H4m12 4h4', chevron: 'm6 9 6 6 6-6', arrow: 'M5 12h14m-6-6 6 6-6 6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2' }
  return <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d={paths[name]} /></svg>
}

/** Keep the existing accessible modal/focus owner, including its WalletConnect
 * handoff. Styling is scoped to header dialogs, never checkout/payment forms. */
export function HeaderDialog({ title, onClose, children, wallet = false, menu = false, pending = false }: { title: string; onClose: () => void; children: ReactNode; wallet?: boolean; menu?: boolean; pending?: boolean }) {
  return <Modal isOpen contentLabel={title} overlayStyle={{backgroundColor:'#000b',backdropFilter:'blur(4px)'}} onRequestClose={onClose} layer={wallet ? 'wallet' : 'dialog'} shouldCloseOnOverlayClick={!pending}
    contentStyle={{ width: 'min(450px, calc(100vw - 24px))', padding: 0, background: menu ? '#000' : '#080609', border: `1px solid ${menu ? '#543c4a' : '#49364f'}`, borderRadius: menu ? 4 : 10, boxShadow: '0 25px 100px #000c' }}>
    <DialogHead><DialogBrand>{menu && <MenuLogo aria-hidden='true' data-menu-logo><Emblem3DLogo spinSpeed={0.25}/></MenuLogo>}<h2>{title}</h2></DialogBrand><CloseButton aria-label={pending ? 'Cancel connection' : 'Close dialog'} onClick={onClose}><HeaderIcon name='close' /></CloseButton></DialogHead>
    <DialogBody>{children}</DialogBody>
  </Modal>
}
// A decorative, lazy-loaded emblem sits beside the menu title, without adding
// a focus stop or changing the wallet dialog's accessible name and controls.
const DialogBrand = styled.div`display:flex;align-items:center;gap:12px;min-width:0;`
const MenuLogo = styled.div`width:40px;height:40px;flex:none;`
export const DialogHead = styled.div`display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px 25px 20px;border-bottom:1px solid #2a202f;h2{font:400 25px/1.2 'Funnel Display',sans-serif;margin:0;}@media(max-width:540px){padding:22px 20px 18px;h2{font-size:23px;}}`
export const DialogBody = styled.div`padding:22px 25px 24px;display:flex;flex-direction:column;gap:12px;p{font:400 13px/1.6 'Host Grotesk',sans-serif;color:#aaa0aa;margin:0;}p[role=alert]{color:#ffada6;}@media(max-width:540px){padding:20px;}`
export const CloseButton = styled.button`width:36px;min-width:36px;height:36px;display:grid;place-items:center;background:#130c18;border:1px solid #49334f;border-radius:24px;color:#d8c5e4;cursor:pointer;&:hover{border-color:#d286ff;}&:focus-visible{outline:2px solid #d286ff;outline-offset:3px;}`
export const WalletOption = styled.button`display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;min-height:64px;border:1px solid #49334f;border-radius:24px;background:#140c1a;color:#efd8ff;text-align:left;cursor:pointer;font:500 14px 'Funnel Display',sans-serif;>svg,>img{width:26px;height:26px;flex:none;object-fit:contain;}span{flex:1;min-width:0;}small{display:block;margin-top:4px;font:400 11px/1.5 'Host Grotesk',sans-serif;color:#aba0ae;}svg:last-child:not(:first-child){width:18px;height:18px;} &:hover:not(:disabled){border-color:#d286ff;background:#211427;}&:focus-visible{outline:2px solid #d286ff;outline-offset:3px;}&:disabled{opacity:.5;cursor:not-allowed;}`
export const DialogAction = styled.button`display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:44px;padding:10px 16px;background:#110d12;border:1px solid #49334f;border-radius:24px;color:#ddcfe4;font:400 13px 'Funnel Display',sans-serif;cursor:pointer;&:hover:not(:disabled){background:#211427;border-color:#986aae;}&:focus-visible{outline:2px solid #d286ff;outline-offset:3px;}&:disabled{opacity:.5;cursor:not-allowed;}`
export const WalletDetails = styled.div`padding:16px;border:1px solid #49334f;border-radius:12px;background:#100b13;color:#d9c0e8;font:400 12px/1.7 'Roboto Mono',monospace;overflow-wrap:anywhere;small{display:block;margin-bottom:6px;color:#aaa0aa;font:11px 'Host Grotesk',sans-serif;}`
