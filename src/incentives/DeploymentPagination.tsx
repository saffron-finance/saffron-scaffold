import type { useDeployments } from '../host/useDeployments'
import { FinePrint,QuietButton,Row } from './styles'

export function DeploymentPagination({data}:{data:ReturnType<typeof useDeployments>}){
  if(data.page===1&&!data.hasNext)return null
  return <Row aria-label='Vault pages'>
    <QuietButton disabled={data.loading||data.page===1} onClick={data.previousPage}>Newer vaults</QuietButton>
    <FinePrint>Page {data.page}</FinePrint>
    <QuietButton disabled={data.loading||!data.hasNext} onClick={data.nextPage}>Older vaults</QuietButton>
  </Row>
}
