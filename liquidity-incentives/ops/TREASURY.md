# Treasury allocation, funding and recovery

The API and creation worker never custody or deposit campaign tokens. A named
treasury wallet executes variable-side operations externally. Funding a reviewed
vault is the release decision; complete canonical funding enables user LP entry.

## Before opening intake

Create the campaign in Administration, then open **Treasury inventory allocations**.
Verify inventory and assign a lifetime ceiling in raw reward-token units to the
campaign. For a token with 18 decimals, one token is `1000000000000000000` raw units.
Record a reason. Changes use the displayed revision and an audited request key.

An allocation includes spent premiums, accepted commitments and unpaid holds.
Its unspent portion is reserved against the named wallet's balance. The sum of
unspent allocations for the same wallet and token cannot exceed that one holding.
Do not count the wallet again under another campaign or count tokens already
funded into a vault as available treasury inventory. Quotes reserve only within
the remaining allocation, in the same transaction as campaign and queue capacity.

Inventory is observed at one confirmed Robinhood block. The observer checks that
block again and verifies the canonical evidence for previously spent premiums.
Unassigned campaigns, insufficient balances, reorgs or unavailable verification
pause new payments. Existing paid obligations remain. An allocation is an
operational commitment; it cannot stop the external wallet from moving tokens.
Pause intake before treasury reallocations or unrelated outgoing transfers.

## Fund a reviewed vault

1. In the vault's Administration row, open **External funding and recovery brief**.
   Refresh it, check the request/plan identifiers and the three creation receipts.
2. Use **Refresh and copy funding brief** immediately before preparing an external
   transaction. Check chain `4663`, vault, reward token, decimals, outstanding raw
   amount and the verified block. Recheck if any funding transaction is pending.
3. In the treasury wallet, approve the vault for the outstanding token amount.
   Execute `vault.deposit(outstandingRaw, 1, "0x")`. The depositor receives variable
   bearer rights. A plain ERC-20 transfer gives no bearer supply and does not count
   as funding. The creation signer and requester receive no treasury rights.
4. Wait for confirmations and refresh the brief. Partial funding reduces the
   outstanding amount but does not enable entry. Full verified funding enables
   **Deposit LP assets**. No manual database status or separate publication flag
   can bypass this gate. The user completes their fixed-side actions in the app.

Never send the total again after a partial or ambiguous deposit. Reconcile the
existing treasury transaction and refresh canonical supply first. Wrong-token or
plain transfers do not satisfy the commitment; investigate the protocol's actual
recovery rights before moving more funds. Do not assume the API can retrieve them.

## Delays, occupied positions and cancellation

Monitor the oldest created-but-unfunded request against the declared service
window. A funding timeout does not release a reservation. Pause intake when a
funding backlog cannot be served and resolve paid non-delivery through the payment
exception queue, including an externally verified fee refund when appropriate.

The unrestricted vault can be occupied by another on-chain fixed depositor. The
requester association does not grant exclusive contract rights. Refresh ownership
and eligibility before funding or recommending entry. Never attribute another
wallet's claim or fixed bearer to the requester.

For retirement, first resolve all signed creation transactions. If an unstarted
fixed claim exists, its owner recovers the LP assets through the app. The variable
bearer owner separately uses the protocol's permitted unstarted premium recovery.
Refresh the brief, approve retirement and run the bounded retirement command.
Only canonical evidence of an unstarted vault with no fixed claims or variable
bearer supply can release unused obligations. A started position follows maturity
rights instead. Fee refunds are separate from campaign accounting.

If a funding or recovery block is orphaned, keep intake paused. Reconcile the
canonical vault and budget; do not edit balances to restore availability. Premium
spent by a started vault and consumed campaign capacity never replenish at maturity.
