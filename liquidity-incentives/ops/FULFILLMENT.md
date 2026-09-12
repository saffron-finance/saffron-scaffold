# Campaign fulfillment and launch ownership

Normal accepted fees enter the automatic queue. The creator deploys the adapter,
deploys the vault and initializes its frozen terms without approval for each
request. External premium funding follows. The fee alone does not make a vault
ready for an LP deposit. Four verified milestones and elapsed time describe its
progress; no delivery estimate is promised by the interface.

## Before paid intake

Assign these responsibilities in the protected operating record before launch.
Names, contact coverage, service windows and initial campaign economics are launch
configuration; this repository intentionally does not invent those values.

| Responsibility | Required operating commitment |
| --- | --- |
| Release and API operator | Correct origin/mount, independent database, protected RPC and price provider, backups, version verification and hosting access. |
| Campaign owner | Verified pair and economics, frozen quote terms, pause/resume decisions and private advisory targets. |
| Watcher and creator operator | Continuous canonical fee scanning, automatic queue supervision, dedicated signer and gas, journal reconciliation and alerts. |
| External premium funder | Coverage for accepted commitments, exact on-chain funding, coordination of any stop, custody of variable bearer rights and later protocol settlement. |
| Refund approver and payer | Determine unfulfillable requests, stop external work, reconcile creator execution, prepare original-fee batches, pay externally and review verified closure. |
| Support and incident owner | Handle lost payment responses, delayed funding and uncertainty; communicate supported service windows without asking users to pay twice. |

Configure the initial campaign and named operators before opening intake. Use an
expiring intake window and declared service window matching staffed coverage.
Neither a timing field nor a private target reserves inventory or guarantees
fulfillment. No request quota, treasury inventory system or gas ledger is added.

## Configure or add a campaign

1. Open Administration, sign in as an allowlisted operator, and open Programs and
   campaign budgets. Verify the pool address, token addresses/decimals and fee tier
   on Robinhood before saving the pair. Symbols are presentation only.
2. Create the campaign with its chosen duration and premium economics. The form
   derives the third economics field from the other two; inspect all three before
   saving. Production starts with an empty catalog and no sample campaign.
3. Review and resume the campaign when ready. Additional pairs and programs use
   this same database-backed interface after launch, without a frontend rebuild.
4. Economics freeze with the first quote. New duration or premium economics require
   a new campaign. The separate private advisory budget remains editable; its
   near-capacity notice appears only in the operator portfolio.

Pausing a campaign or intake stops new quotes while preserving fees and accepted
work. Resume through the existing operator controls after addressing the cause.
Do not delete accepted records to change economics or to clear a backlog.

## Automatic creation and premium funding

Follow [service configuration](README.md) to supervise the keyless watcher and
the separate creator with protected credentials. Select **Automatic queue** when
opening the intake window. Its live heartbeat, canonical watcher, nonce, protocol,
recipient, price and offer-sizing checks must pass before checkout becomes ready.
The UI selection does not start or authorize a signer process by itself.

The creator performs only creation and initialization. The optional
[reviewed one-request runner](ONE-REQUEST.md) remains useful for testing and
recovery; it is not required for normal user requests. Retain its permanent
permits and all signed transaction journals across restarts.

The external funder identifies the request and exact frozen premium from the
operator view and verifies the vault terms. Follow [external funding](TREASURY.md).
Partial funding keeps LP entry disabled. The full canonical variable bearer
supply and covered token balance are required, along with initialized terms and
unoccupied fixed capacity. An operator flag cannot make a vault depositable.

The funder owns variable-side rights and remains responsible for their later
protocol fee settlement. The public interface covers the user's fixed-side
deposit, premium claim and maturity withdrawal; it does not transfer those
external responsibilities to the fixed-side user.

## Alerts and exceptions

Use Administration's oldest unprogressed request, funding backlog, unresolved
payment and stale-observation alerts. Check the relevant service and canonical
journal before choosing an action. An RPC outage or slow receipt does not prove
that a transaction failed and never authorizes a replacement payment by itself.

When deployment or premium funding cannot be fulfilled, the responsible operator
records that decision and coordinates the external stop. Follow
[refund approval, batch payment and verification](REFUNDS.md). Repay the original
ETH creation fee in full, with gas and sender charges separately covered. Refund
closure requires verified repayment and reconciled creator work. Temporary delay
does not automatically approve a refund or establish a refund deadline.

## QA state and production recovery

The [interactive QA fixture](vnc/README.md) uses transient services and generated
wallet keys held only in memory. An archive of its chain/database is evidence,
not a backup of those wallet keys. Preserve the populated fixture during ordinary
frontend publication or refresh. Intentionally resetting it requires archiving
and checking the old state through its runbook first.

Production recovery uses protected PostgreSQL backups/WAL, configuration, watcher
cursors and signer permits as described in [operations](README.md). A QA reset or
successful disposable test does not qualify restoration of production funds.
