import styled from 'styled-components'
import {PrimaryAction,QuietButton} from './styles'

/** Shared P3/R1 visual vocabulary. These scoped components never replace the
 * application theme or PrimaryAction's saved appearance-control variables. */
export const AdminAction=styled(PrimaryAction)`
 width:auto;min-height:46px;min-width:0;padding:11px 18px;font:400 14px ${p=>p.theme.fonts.display};
 white-space:normal;line-height:1.5;border-radius:8px;
`
export const AdminOutline=styled(QuietButton)`
 min-height:44px;min-width:0;padding:10px 16px;border:1px solid #66526e;border-radius:8px;
 background:linear-gradient(130deg,#1b1220,#100d12 75%);color:#e1cee9;
 font:400 14px/1.5 ${p=>p.theme.fonts.display};white-space:normal;
 &:hover:not(:disabled){border-color:#bf8fd0;background-color:#22142a}
 &:focus-visible{outline:2px solid #d286ff;outline-offset:3px}
`
export const AdminKicker=styled.p`margin:0;color:#cf94df;font:10px/1.6 ${p=>p.theme.fonts.mono};letter-spacing:.065em;text-transform:uppercase;`
export const AdminPanel=styled.section`
 min-width:0;padding:24px;border:1px solid #302a34;border-radius:10px;background:#0a090b;
 h2,h3{margin:0;font-family:${p=>p.theme.fonts.display};font-weight:400}h2{font-size:23px}h3{font-size:19px}
 @media(max-width:650px){padding:18px 14px}
`
export const AdminGold=styled.span`
 color:${p=>p.theme.colors.accent.gold};font:400 32px/1.2 ${p=>p.theme.fonts.display};
 font-variant-numeric:tabular-nums;letter-spacing:-.03em;overflow-wrap:anywhere;
 small{font-size:13px;color:#b2a0b9;letter-spacing:0;margin-left:7px}
`
export const AdminBadge=styled.span<{$tone?:'review'|'approved'|'neutral'}>`
 display:inline-flex;align-items:center;align-self:flex-start;gap:6px;max-width:100%;width:fit-content;padding:5px 8px;
 border:1px solid ${p=>p.$tone==='review'?'#725140':p.$tone==='approved'?'#456351':'#574c5c'};
 background:${p=>p.$tone==='review'?'#281a14':p.$tone==='approved'?'#102017':'#19131b'};
 color:${p=>p.$tone==='review'?'#eac1a0':p.$tone==='approved'?'#aed4bc':'#cbbcd1'};
 border-radius:5px;font:10px/1.5 ${p=>p.theme.fonts.mono};overflow-wrap:anywhere;
 &::before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor;flex:none}
`
export const AdminField=styled.label`
 display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px;line-height:1.5;color:#c6b7cd;
 input,select,textarea{box-sizing:border-box;min-width:0;width:100%;min-height:46px;padding:11px 13px;border:1px solid #413847;border-radius:7px;background:#0c0a0d;color:#e8dfea;font:400 14px/1.5 ${p=>p.theme.fonts.body};font-variant-numeric:tabular-nums}
 textarea{min-height:80px;resize:vertical}
 input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #d286ff;outline-offset:3px}
`
export const AdminCheck=styled.label`
 display:flex;align-items:flex-start;gap:10px;font-size:12px;line-height:1.6;color:#c9bfd0;
 input{flex:none;margin:3px 0 0;width:17px;height:17px;accent-color:#ae6ac9;color-scheme:dark}
`
