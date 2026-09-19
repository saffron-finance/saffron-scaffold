# Current paid-request progress

The modal uses the current backend reasons: queued, creating, awaiting_funding,
operator_review, verification_unavailable and ready. Creation has three
transaction milestones; external premium funding is the fourth milestone and
uses awaiting_funding. Timers never advance these states.

Approved refunds keep their own pending, refunded and verification-exception
headings, exact ETH evidence and a stopped spinner. The backend execution-stop
flag remains part of the refund contract. Payment recovery, stale-read gates,
Portfolio reopening and explicit LP deposit/claim/withdrawal actions are unchanged.

There is no retirement workflow, retirement display, old payment-reason display,
or wallet-free sample marker. The copy-review examples S15 and S40–S43 were
removed; surviving review IDs are unchanged for existing copy edits.

Verification: focused presenter and database/refund tests were written before
removal. The compiled app is exercised with read-only wallet/API fixtures;
onchain integration is a separate check, not implied by those browser tests.
