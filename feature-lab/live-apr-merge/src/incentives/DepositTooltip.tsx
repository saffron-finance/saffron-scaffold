import { type CSSProperties,type ReactNode,useEffect,useId,useLayoutEffect,useRef,useState } from 'react'
import styled from 'styled-components'
import { TokenIcon } from './TokenIcon'
import '../host/TooltipSurface.css'

/** First review bullet with an amount-only trigger and non-interactive LP breakdown. Hover and keyboard
 * focus reveal it; click/tap pins it. Pointer travel into the tooltip is allowed.
 * Outside tap, blur or Escape dismisses it. Escape is consumed only while open,
 * so the parent modal stays open on the first Escape and closes on the next.
 * Amounts are preformatted display labels; this component cannot move funds.
 */
export function DepositTooltip({value,assets}:{value:string;assets:{amount:string;symbol:string;address?:string}[]}){
  return <InlineTooltip label={value} prefix='You deposit: ' suffix=' into Uniswap v3.'>
    <strong>Your LP tokens</strong>
    {assets.map((asset,index)=><Asset key={index}><span aria-hidden='true'><TokenIcon symbol={asset.symbol} address={asset.address} size={20}/></span><span><b>{asset.amount}</b> {asset.symbol}</span></Asset>)}
    <TooltipNote>Deposited to Uniswap v3</TooltipNote>
  </InlineTooltip>
}

/** Shared inline help keeps amount/risk bubbles visually identical. Help with
 * a documentation link is a non-modal popover, allowing keyboard focus into
 * the link; the read-only amount breakdown retains tooltip semantics. */
export function InlineTooltip({label,prefix,suffix,children,interactive=false}:{label:string;prefix:ReactNode;suffix:ReactNode;children:ReactNode;interactive?:boolean}){
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
  },[open,label])
  useEffect(()=>{
    if(!open)return
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close()}
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();event.stopPropagation()
        // Return focus from a dismissed documentation link to its visible term.
        if(interactive&&root.current?.contains(document.activeElement))trigger.current?.focus({preventScroll:true})
        close()
      }
    }
    document.addEventListener('pointerdown',outside,true)
    document.addEventListener('keydown',escape,true)
    return ()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true)}
  },[open,interactive])
  return <Line ref={line}><span>{prefix}</span><Anchor ref={root}
    onPointerEnter={event=>{if(event.pointerType==='mouse')setOpen(true)}}
    onPointerLeave={event=>{if(event.pointerType==='mouse'&&!pinned.current)setOpen(false)}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))close()}}>
    <Trigger ref={trigger} type='button' aria-expanded={open} aria-controls={id} aria-describedby={!interactive&&open?id:undefined} aria-haspopup={interactive?'dialog':undefined}
      onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))setOpen(true)}}
      onClick={()=>{pinned.current=!pinned.current;setOpen(pinned.current)}}>
      <b>{label}</b>
    </Trigger>
    <Tip role={interactive?'dialog':'tooltip'} aria-label={interactive?label:undefined} id={id} hidden={!open} style={position}>
      {children}
    </Tip>
  </Anchor><span>{suffix}</span></Line>
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
// Share paint with compact navigation without importing modal logic there.
const Tip=styled.span.attrs({className:'saffron-tooltip-surface'})`position:absolute;z-index:5;`
// Keep the additional venue note compact so the bubble cannot cover Back.
const TooltipNote=styled.span`font-size:12px;`
const Asset=styled.span`display:flex;align-items:center;gap:8px;min-width:0;>span:first-child{display:flex;flex:none;} >span:last-child{min-width:0;}`
