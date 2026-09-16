import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ServerStyleSheet, ThemeProvider } from 'styled-components'
import { AppShell } from '../src/host/AppShell'
import { darkTheme } from '../src/host/ui'
import { HomeCatalog, OfferGroup, OfferRow } from '../src/incentives/HomeCatalog'
import type { Offer } from '../src/incentives/model'

/** Build-only placeholder data. No live/private catalog, wallet or credentials
 * can enter the document template. The browser replaces text from its existing
 * validated display cache, and never persists HTML or enabled actions. */
const example={id:'warm-example',pairId:'warm-pair',active:true,availability:null,
  apr:0,days:1,feeTier:3000,isNew:false,budget:{paused:false},
  token0:{address:'0x0000000000000000000000000000000000000001',symbol:'__WARM_TOKEN0__',decimals:18},
  token1:{address:'0x0000000000000000000000000000000000000002',symbol:'__WARM_TOKEN1__',decimals:18},
} as Offer

/** Generate exactly the same shell, grouping and row variants used by React.
 * Styles are local to the snapshot, not a fake styled-components hydration
 * cache: the application removes them after its own first committed render. */
export function warmTemplates() {
  const sheet=new ServerStyleSheet()
  const render=(node:React.ReactElement)=>renderToString(sheet.collectStyles(node))
  try {
    const shell=render(<MemoryRouter><AppShell account={null} onConnect={()=>{}} pageLabel='Home'>
      <section className='saffron-catalog-page' data-catalog-home='true'>
        <HomeCatalog catalog={{offers:[],loading:true,hasSnapshot:true}}/>
      </section>
    </AppShell></MemoryRouter>)
    const group=render(<ThemeProvider theme={darkTheme}><OfferGroup offers={[example]}/></ThemeProvider>)
    const variants:Record<string,string>={}
    for(const live of [true,false])for(const isNew of [true,false]) {
      variants[`${live}-${isNew}`]=render(<ThemeProvider theme={darkTheme}>
        <OfferRow offer={{...example,active:live}} isNew={isNew}/>
      </ThemeProvider>)
    }
    return {shell,group,variants,css:sheet.getStyleTags().replace(/data-styled[^=]*="[^"]*"/g,'').replace('<style ','<style data-warm-css ')}
  } finally {sheet.seal()}
}
