import type { ReactNode } from 'react'
import styled from 'styled-components'
import { Card, StepTitle, StepSubtitle } from '../host/ui'

/** Shared local-page structure. It uses the existing typography and card theme;
 * no fetches, timers or APR observations start when these sections are mounted. */
function SectionPage({ title, description, children }: {
  title: string; description: string; children: ReactNode;
}) {
  return <Page aria-labelledby='section-title'>
    <Heading><StepTitle id='section-title'>{title}</StepTitle><StepSubtitle>{description}</StepSubtitle></Heading>
    {children}
  </Page>
}

/** Reserved stats slots deliberately show no invented figures. A later data
 * adapter can populate these cards without changing their host or navigation. */
export function StatsPage() {
  return <SectionPage title='Stats' description='A home for Saffron activity and performance.'>
    <SectionIntro><SectionTitle>Protocol overview</SectionTitle><Status>Coming soon</Status></SectionIntro>
    <Grid aria-label='Protocol statistics'>
      {['Total value locked', 'Active vaults', 'Fees earned'].map(label =>
        <Panel as='article' key={label}>
          <CardTitle>{label}</CardTitle><EmptyValue aria-label='Not available yet'>—</EmptyValue>
          <Description>Not available yet</Description>
        </Panel>
      )}
    </Grid>
    <Panel as='section' aria-labelledby='vault-activity-title'>
      <CardTitle as='h2' id='vault-activity-title'>Vault activity</CardTitle>
      <EmptyState>Vault activity and performance updates will appear here.</EmptyState>
    </Panel>
  </SectionPage>
}

/** Community is an in-app destination, with room for future announcements.
 * Only explicit resource actions open external sites; no external feed loads. */
export function CommunityPage() {
  return <SectionPage title='Community' description='Updates, conversations and resources from Saffron.'>
    <Panel as='section' aria-labelledby='announcements-title'>
      <SectionIntro><CardTitle as='h2' id='announcements-title'>Announcements</CardTitle><Status>Coming soon</Status></SectionIntro>
      <EmptyState>Community news and announcements will appear here.</EmptyState>
    </Panel>
    <Grid aria-label='Community resources'>
      <Panel as='article'>
        <CardTitle as='h2'>Join the conversation</CardTitle>
        <Description>Meet the Saffron community and join the discussion.</Description>
        <ResourceLink href='https://discord.com/invite/pDXpXKY' target='_blank' rel='noopener noreferrer'>Open Discord <span aria-hidden='true'>↗</span></ResourceLink>
      </Panel>
      <Panel as='article'>
        <CardTitle as='h2'>Explore the documentation</CardTitle>
        <Description>Learn about Saffron, its vaults and the protocol.</Description>
        <ResourceLink href='https://docs.saffron.finance/' target='_blank' rel='noopener noreferrer'>Read the docs <span aria-hidden='true'>↗</span></ResourceLink>
      </Panel>
    </Grid>
  </SectionPage>
}

const Page = styled.section`display:flex;flex-direction:column;gap:28px;min-width:0;width:100%;`
const Heading = styled.header`display:flex;flex-direction:column;gap:18px;p{line-height:1.6;}`
const SectionIntro = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;`
const SectionTitle = styled.h2`margin:0;font:400 22px ${p => p.theme.fonts.display};`
// Auto-fit responds to the actual pane, including the expanded desktop rail.
const Grid = styled.div`display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:20px;min-width:0;`
const Panel = styled(Card)`display:flex;flex-direction:column;gap:18px;min-width:0;padding:28px;@media(max-width:600px){padding:22px 18px;}`
const CardTitle = styled.h3`margin:0;font:400 20px ${p => p.theme.fonts.display};line-height:1.3;`
const Description = styled.p`margin:0;color:${p => p.theme.colors.text.tertiary};font-size:14px;line-height:1.6;`
const EmptyValue = styled.span`font:400 36px ${p => p.theme.fonts.display};color:${p => p.theme.colors.text.secondary};`
const EmptyState = styled(Description)`padding:22px 0;`
const Status = styled.span`padding:6px 10px;border:1px solid ${p => p.theme.colors.border.base};border-radius:var(--radius-md);font-size:11px;letter-spacing:.04em;color:${p => p.theme.colors.text.tertiary};white-space:nowrap;`
const ResourceLink = styled.a`
  align-self:flex-start;margin-top:auto;padding:5px 0;color:${p => p.theme.colors.text.primary};font-size:13px;
  text-underline-offset:4px;text-decoration:underline;
  &:hover{color:${p => p.theme.colors.accent.gold};}
  &:focus-visible{outline:2px solid ${p => p.theme.colors.accent.gold};outline-offset:5px;}
`
