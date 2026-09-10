import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell, WalletButton, WalletList } from '../host/AppShell'
import { Modal, ModalTitle } from '../host/ui'
import IncentivesPage from '../incentives/IncentivesPage'
import { PREVIEW_ACCOUNT, resetPreview } from './runtime'

// Preserve links already shared with reviewers, now on a proper campaign page.
if (new URLSearchParams(location.search).get('view') === 'campaigns') {
  history.replaceState(null, '', import.meta.env.BASE_URL + 'campaigns/')
}

/** Real feature components and approved shell, with browser-only sample data.
 * The connect affordance explains preview mode and never discovers a wallet. */
function Preview() {
  const [info, setInfo] = useState(false)
  return <AppShell account={null} onConnect={() => setInfo(true)}
    previewControls={<WalletButton onClick={resetPreview}>Reset preview</WalletButton>}
    overlays={<Modal isOpen={info} onRequestClose={() => setInfo(false)}>
      <ModalTitle>Feature Lab preview</ModalTitle>
      <WalletList><p>Explore the vaults, campaigns and payment review with sample data. Payments are simulated and changes are saved only in this browser. No wallet connection is needed.</p>
        <WalletButton onClick={() => setInfo(false)}>Continue preview</WalletButton>
      </WalletList>
    </Modal>}>
    <IncentivesPage account={PREVIEW_ACCOUNT} onConnect={() => setInfo(true)} preview />
  </AppShell>
}
createRoot(document.getElementById('root')!).render(<Preview />)
