# One deposit progress surface

Request preparation and payment confirmation share the same purple-spinner presenter as accepted-request preparation, creation, checking and verification. The status appears immediately beneath the spinner; only the current status is shown. Backend evidence, not elapsed time, advances creation. Ready, unavailable, retired and refund states stop the animation, and reduced-motion disables it.

The four gold stage rows, their marker animation, duplicate spinner styling, unused waiting state, three unused modal styles and per-second elapsed timer are removed. Requested/verified timestamps, transaction links, manual refresh and service-window evidence stay under Deployment transactions. Saved requests still reopen through Portfolio. Exact payment, cancellation, refunds, stale-read gating and explicit LP entry are unchanged.

## Local mock and checks

Run `npm test`, `npm run build`, then `npm run test:deposit-spinner` for a compiled production-component preview and eight screenshots. It uses real modal interactions and the real status-polling hook with controlled quote/payment props and mocked HTTP responses. It has no wallet provider, signer or chain. Do not deploy the preview.

Run `MERGE_DIST=dist npm run test:deposit-spinner:runtime` to exercise the actual application bundle through Portfolio with a loopback read-only API/wallet fixture. This verifies all four creation stages, saved-request reopen, verification failure and narrow layouts. Real onchain integration suites are separate and are not invoked by these commands.

## Deposit actions

The ready-vault “Deposit LP assets” button, Portfolio deposits, and position deposit/approval/wrapping steps reuse the existing `PrimaryAction` purple-gradient treatment. Non-deposit actions retain their existing styling. Click handlers, labels and eligibility/disabled checks are unchanged.

`DepositActions.test.tsx` covers explicit clicks, stale Portfolio data, approval labels, blocked/busy/loading deposits, and unchanged claim/withdraw/recovery actions. The compiled runtime fixture additionally checks the actual purple gradient, hover, keyboard focus, disabled opacity and responsive layout. These checks use controlled data, not real transactions.
