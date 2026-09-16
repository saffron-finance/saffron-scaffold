import {act,fireEvent,screen} from '@testing-library/react'
import {expect,it,vi} from 'vitest'
import type {ReactNode} from 'react'
vi.mock('../host/transport',()=>({setViewerWallet:()=>{}}))
vi.mock('../host/AppShell',()=>({AppShell:({children}:{children:ReactNode})=>children}))
vi.mock('@merge/session',()=>({useMergeSession:()=>({account:null,chainId:null,openModal:()=>{},overlays:null})}))
vi.mock('../incentives/IncentivesPage',()=>({default:()=>{
  if(location.pathname==='/campaigns')throw Error('Fixture campaign render failure')
  return <h1>Recovered home</h1>
}}))

it('M08 actual route owner resets the section boundary when Return to Home is chosen',async()=>{
  vi.spyOn(console,'error').mockImplementation(()=>{})
  vi.spyOn(window,'scrollTo').mockImplementation(()=>{})
  history.replaceState(null,'','/campaigns')
  document.body.innerHTML='<div id="root"></div>'
  await act(async()=>{await import('./main')})
  expect(screen.getByText('This section could not load')).toBeTruthy()
  await act(async()=>{fireEvent.click(screen.getByRole('link',{name:'Return to Home'}))})
  expect(screen.getByText('Recovered home')).toBeTruthy()
  expect(screen.queryByText('This section could not load')).toBeNull()
  vi.restoreAllMocks()
})
