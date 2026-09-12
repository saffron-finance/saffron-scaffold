# External premium funding

Premium custody and funding remain outside the application. There is no treasury
inventory allocation, balance polling, reservation, or funding-brief system.

Review the accepted quote, chain, factory/type identities, exact vault, and raw
premium before an independently authorized external deposit. The funder receives
variable-side bearer rights and manages those rights externally. The creator
cannot fund premiums or recover external funds.

The API observes the individual vault's canonical variable supply and covered
token balance to decide when users can enter. Partial funding does not enable
entry. Request-time USD values are historical valuation, not current inventory.

Refunds, if needed, are processed manually outside the app. There is no refund
request or retirement workflow. Ordinary user LP recovery remains available
when canonical ownership and protocol state allow it.
