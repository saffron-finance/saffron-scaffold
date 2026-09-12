import styled from 'styled-components'
import LivePoolAprRoute from '../livePoolApr/LivePoolAprRoute'
import { PoolPicker } from '../livePoolApr/PoolPicker'
import './apr-layout.css'

/** No app root or new provider: the portable route uses the existing host.
 * Its header slot is inside PoolTilesProvider, where the picker belongs. */
export default function AprSection() {
  return <Container data-apr-section>
    <LivePoolAprRoute basePath='/live-apr' header={<Toolbar data-apr-toolbar><div><Title>Live APR</Title><Subtitle>Live pool fee observations · Robinhood Chain</Subtitle></div><PoolPicker /></Toolbar>} />
  </Container>
}
const Container = styled.section`
  container: live-apr / inline-size;
  width:100%;min-width:0;
`
const Toolbar = styled.div`
  position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 28px;min-width:0;
  > div:first-child { min-width:0; }
  > div:last-child { position:static; }
  #tokens-menu { left:auto;right:0;max-width:100%;width:min(460px,100%); }
`
const Title = styled.h2`font-family:${p=>p.theme.fonts.display};font-size:22px;line-height:1.2;font-weight:400;margin:0 0 6px;`
const Subtitle = styled.p`font-size:12px;line-height:1.4;color:${p=>p.theme.colors.text.tertiary};margin:0;`
