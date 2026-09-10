import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import styled,{ThemeProvider} from 'styled-components'
import { darkTheme,GlobalStyles,StepTitle } from '../host/ui'
import { Sidebar } from '../host/Sidebar'
import { sidebarCollapsedWidth,sidebarMobileWidth } from '../host/sidebarTheme'
import IncentivesPage from '../incentives/IncentivesPage'
import { ProgramAdmin } from '../incentives/ProgramAdmin'
import { PREVIEW_ACCOUNT,resetPreview } from './runtime'

/** Preview-only shell around actual feature components, not screenshot mockups.
 * It never imports the production wallet provider or installs an injected wallet. */
function Preview(){
  const [collapsed,setCollapsed]=useState(false)
  const campaigns=new URLSearchParams(location.search).get('view')==='campaigns'
  return <ThemeProvider theme={darkTheme}><GlobalStyles/><Frame $collapsed={collapsed}>
    <Sidebar home={import.meta.env.BASE_URL} collapsed={collapsed} onToggle={()=>setCollapsed(!collapsed)}/>
    <Content>
      <PreviewBar aria-label='UI preview controls'><b>UI preview</b><span>Sample data · no wallet or transactions</span>
        <nav><a aria-current={!campaigns?'page':undefined} href={import.meta.env.BASE_URL}>User flow</a><a aria-current={campaigns?'page':undefined} href={import.meta.env.BASE_URL+'?view=campaigns'}>Campaigns</a><button onClick={resetPreview}>Reset preview</button></nav>
      </PreviewBar>
      <Main id='main-content'>{campaigns?<><StepTitle>Campaigns</StepTitle><Notice>Create sample campaigns and try all three calculator modes. Changes are saved only in this browser. The example starts with 50% funded.</Notice><ProgramAdmin autoLoad account={PREVIEW_ACCOUNT} onConnect={()=>{}}/></>:<><Notice>The $2 ETH payment button is simulated here. Explore the latest UI without connecting a wallet.</Notice><IncentivesPage account={PREVIEW_ACCOUNT} onConnect={()=>{}}/></>}</Main>
      <Footer><a href='/saffron/apps/feature-lab/'>Saffron Feature Lab</a></Footer>
    </Content>
  </Frame></ThemeProvider>
}
const Frame=styled.div<{$collapsed:boolean}>`color:${p=>p.theme.colors.text.primary};min-height:100vh;display:grid;grid-template-columns:252px minmax(0,1fr);@media(max-width:1100px){grid-template-columns:220px minmax(0,1fr)}@media(max-width:${sidebarMobileWidth}px){grid-template-columns:minmax(0,1fr)}${p=>p.$collapsed?`&&{grid-template-columns:${sidebarCollapsedWidth}px minmax(0,1fr)}`:''}`
const Content=styled.div`min-width:0;display:flex;flex-direction:column;`
const PreviewBar=styled.header`margin:20px var(--page-padding-x);padding:16px;border:1px solid #ffbc0944;border-radius:10px;display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:12px;b{color:#ffbc09}span{color:#aaa}nav{display:flex;gap:16px;flex-wrap:wrap;margin-left:auto}a,button{color:inherit;background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:4px}a[aria-current]{color:#ffbc09}@media(max-width:600px){nav{margin-left:0;width:100%}}`
const Main=styled.main`width:100%;max-width:var(--page-max-width);padding:0 var(--page-padding-x);margin:0 auto;flex:1;min-width:0;`
const Notice=styled.p`font-size:13px;line-height:1.6;color:#aaa;margin:16px 0 24px;`
const Footer=styled.footer`padding:32px;text-align:center;font-size:12px;color:#aaa;a{color:inherit}`
createRoot(document.getElementById('root')!).render(<Preview/> )
