# Externally paid creation-fee refunds

The approved policy covers an accepted request whose deployment cannot be
completed or whose required premium cannot be provided. Return its exact
original ETH creation fee on Robinhood (4663), regardless of later ETH prices.
The user pays original wallet gas separately; refund gas and bulksender service
charges must not reduce repayment. Delays and RPC outages do not automatically
approve a refund. Set service coverage and responsible operators before launch.

## Operator procedure

1. In Administration → External creation-fee refunds, load requests and select
   the original payments. Check the vault journal and coordinate a stop with the
   external premium funder. Select the distinct deployment/funding failure reason
   and record why it cannot be fulfilled. Approval uses a row revision and stable
   idempotency key; it disables further creator signing and admission immediately.
2. Wait for the active creator lease to finish. Reconcile every journaled nonce
   and transaction, including any external wallet replacement, through the existing
   journal controls. A missing receipt or unresolved signed transaction blocks
   batch preparation and closure. Approval does not erase a broadcast.
3. Select approved obligations, enter the approved external refund sender and
   prepare a batch. The immutable manifest includes source, author, original
   payments, revisions, exact remaining wei, recipients and allocations, plus the
   chain height before payment. Transfers mined before preparation are ineligible.
   Several
   fees for one payer are combined. Each batch supports 100 original payments;
   prepare additional batches for larger queues. No gas or treasury inventory is
   reserved. Preparing or exporting a CSV does not mean a payout occurred.
4. Download the original CSV and import it into bulksender.app for native ETH on
   Robinhood. Format is `address,decimal ETH` without a header, with all 18 decimal
   places preserved. Compare its recipients and amounts with the manifest before
   signing in the external wallet. Do not open/save the amounts through software
   that rounds them. Gas and sender-service fee are extra.
5. Record the resulting transaction hash(es), up to 25 per submission. The API
   verifies asynchronously, in passes of up to 12 transactions with three concurrent
   reads. Each transaction is bound to one manifest; each payout can allocate to
   several obligations without crediting the same wei twice. Refresh verification
   for pending, failed, unverified, verified, partial and unmatched outcomes.
6. A full canonical repayment closes the request only after execution is reconciled
   and no user LP position is present. The application keeps the original evidence,
   execution stop and audit history. It releases only the unallocated commitment;
   externally funded or spent premium is not replenished by a fee refund. The funder
   remains responsible for any separate protocol recovery/settlement.

Never resend merely because a receipt is slow. The CSV always represents its
original frozen manifest. To pay a deliberate remainder, reconcile **every**
submission first, then use “Close reconciled manifest to prepare a remaining-amount
batch.” Reconciliation must be recent and no hash may be uncertain. Prepare a new
batch from the selected remaining obligations. This also checks submissions in
earlier superseded manifests. Credit never exceeds a manifest's frozen allocation;
extra amounts remain visible as surplus. Unknown/wrapped sender transactions
require qualification; an operator assertion cannot turn them into paid evidence.

## Proof and recovery boundary

Direct native sends verify sender, destination/value and canonical success. The
qualified bulksender proxy is `0x458b14915e651243Acf89C05859a22d5Cff976A6`, with
implementation `0xfef30792394a1b0b4ee25faad927ba8e2b2d5d96`. The verifier supports
only direct `bulksendEther(address[],uint256[],bytes32)` calls. The first array
entries are sender metadata; actual payouts start at index 1. All listed ETH
transfers succeed or the operation reverts. The aggregate event is not treated
as per-recipient proof. Arbitrary wrappers may catch an inner failure and are
unsupported even when their outer receipt succeeds.

The pinned runtime and block qualification are in
`tests/fixtures/bulksender-qualified.json`. Verification checks proxy/runtime
identity and the implementation storage slot at the parent and execution block,
and rejects unexpected proxy logs in the execution block, including upgrades.
Unknown code, entrypoints or upgrade history require requalification. Ordinary
`eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`,
`eth_blockNumber`, `eth_getCode`, `eth_getStorageAt`, `eth_getLogs` and `eth_chainId`
are sufficient; no tracing or state overrides are required in production.

Disposable tests install the pinned public runtime, exercise native transfers
and recipient rollback, and call the production verifier with all trace/debug
methods unavailable. This is focused qualification, not a general contract audit.
The pinned ABI/transaction construction comes from [bulksender.app](https://bulksender.app/).

Reorgs or lost verification remove canonical credit and raise a refund exception
while creation stays disabled. No automatic repeat payout or worker resume occurs.
Every change of verification and allocation is preserved in the verification
audit. A payout that becomes canonical again after a replacement already repaid
the fee appears as surplus; it cannot credit the same obligation twice.
Refund tables, original obligations, audits and creator journals must be backed up
together. Restart resumes oldest-first verification with durable leases. Do not
restore an older database over later external payouts without reconciling their
hashes and allocations. A compatible frontend rollback retains these records;
older backends lacking the execution-stop rules are not safe rollback targets.

Existing LP owners always retain claim/recovery/withdrawal access according to
canonical protocol rights. Stopping a request in this interface cannot revoke
an on-chain transaction or prevent a third party from interacting directly with
the contract. The external funder must honor the recorded stop.
