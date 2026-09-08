/** A nonce-bound, read-only proof; this never authorizes a payment or deployment. */
export function adminListMessage({ wallet, chainId, nonce, expiresAt }) {
  return ['Standalone LiqiFi: view pending vault requests as admin',
    'Read-only access. No transaction or vault creation is authorized.',
    `Wallet: ${wallet.toLowerCase()}`, `Chain: ${chainId}`, `Nonce: ${nonce}`, `Expires: ${expiresAt}`].join('\n')
}
