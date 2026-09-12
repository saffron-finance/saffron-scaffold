import { type CSSProperties,useEffect,useId,useLayoutEffect,useRef,useState } from 'react'
import styled from 'styled-components'
import { TokenIcon } from './TokenIcon'

/** First review bullet with an amount-only trigger and non-interactive LP breakdown. Hover and keyboard
 * focus reveal it; click/tap pins it. Pointer travel into the tooltip is allowed.
 * Outside tap, blur or Escape dismisses it. Escape is consumed only while open,
 * so the parent modal stays open on the first Escape and closes on the next.
 * Amounts are preformatted display labels; this component cannot move funds.
 */
export function DepositTooltip({value,assets}:{value:string;assets:{amount:string;symbol:string;address?:string}[]}){
  const [open,setOpen]=useState(false),root=useRef<HTMLSpanElement>(null),pinned=useRef(false)
  const line=useRef<HTMLSpanElement>(null),trigger=useRef<HTMLButtonElement>(null)
  const [position,setPosition]=useState<CSSProperties>({})
  const id=useId()
  // Clear the touch/click pin along with visibility, so the next tap opens once.
  function close(){pinned.current=false;setOpen(false)}
  useLayoutEffect(()=>{
    if(!open||!line.current||!trigger.current)return
    /** Measure the amount, not the sentence. Keep the bubble inside the bullet
     * while its caret and narrow hover bridge stay centered on the amount.
     * Observe wrapping/font/viewport changes, including a wrapped mobile line.
     */
    const place=()=>{
      const bounds=line.current!.getBoundingClientRect(),amount=trigger.current!.getBoundingClientRect()
      const width=Math.min(340,bounds.width),center=amount.x+amount.width/2-bounds.x
      const left=Math.max(0,Math.min(center-width/2,bounds.width-width))
      setPosition({left,width,bottom:bounds.bottom-amount.top+8,
        '--caret-x':`${center-left-1}px`,'--anchor-width':`${amount.width}px`} as CSSProperties)
    }
    place()
    const observer=new ResizeObserver(place)
    observer.observe(line.current);observer.observe(trigger.current)
    return ()=>observer.disconnect()
  },[open,value])
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close()}
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close()}
    }
    document.addEventListener('pointerdown',outside,true)
    document.addEventListener('keydown',escape,true)
    return ()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true)}
  },[open])
  return <Line ref={line}><span>You deposit: </span><Anchor ref={root}
    onPointerEnter={event=>{if(event.pointerType==='mouse')setOpen(true)}}
    onPointerLeave={event=>{if(event.pointerType==='mouse'&&!pinned.current)setOpen(false)}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))close()}}>
    <Trigger ref={trigger} type='button' aria-expanded={open} aria-controls={id} aria-describedby={open?id:undefined}
      onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))setOpen(true)}}
      onClick={()=>{pinned.current=!pinned.current;setOpen(pinned.current)}}>
      <b>{value}</b>
    </Trigger>
    <Tip role='tooltip' id={id} hidden={!open} style={position}>
      <strong>Your LP tokens</strong>
      {assets.map((asset,index)=><Asset key={index}><span aria-hidden='true'><TokenIcon symbol={asset.symbol} address={asset.address} size={20}/></span><span><b>{asset.amount}</b> {asset.symbol}</span></Asset>)}
      <TooltipNote>Deposited to Uniswap v3</TooltipNote>
    </Tip>
  </Anchor><span> into Uniswap v3.</span></Line>
}

// Keep the tooltip inside the bullet's available width, including 320px phones.
// Only the inline amount and tooltip are hoverable; the sentence is plain text.
// Anchor deliberately stays static: Line is the bubble's containing block.
const Line=styled.span`position:relative;display:block;min-width:0;`
const Anchor=styled.span`display:inline;`
const Trigger=styled.button`
  appearance:none;border:0;padding:0;margin:0;background:transparent;color:inherit;
  font:inherit;line-height:inherit;text-align:left;cursor:pointer;
  b{ text-decoration:underline dotted; text-underline-offset:3px; }
  &:focus-visible{outline:2px solid ${({theme})=>theme.colors.semantic.success};outline-offset:3px;border-radius:3px;}
`
const Tip=styled.span`
  position:absolute;z-index:5;box-sizing:border-box;
  display:flex;flex-direction:column;gap:3px;padding:8px 12px;border:1px solid #363636;
  border-radius:var(--radius-md);background:#1d1d1d;color:#fff;
  box-shadow:0 8px 24px #0009;font-size:13px;line-height:1.25;overflow-wrap:anywhere;
  &[hidden]{display:none;}
  &::before{content:'';position:absolute;top:100%;left:var(--caret-x);width:var(--anchor-width);height:9px;transform:translateX(-50%);}
  &::after{content:'';position:absolute;top:calc(100% - 5px);left:var(--caret-x);width:10px;height:10px;transform:translateX(-50%) rotate(45deg);background:#1d1d1d;border-right:1px solid #363636;border-bottom:1px solid #363636;}
`
// Keep the additional venue note compact so the bubble cannot cover Back.
const TooltipNote=styled.span`font-size:12px;`
const Asset=styled.span`display:flex;align-items:center;gap:8px;min-width:0;>span:first-child{display:flex;flex:none;} >span:last-child{min-width:0;}`
