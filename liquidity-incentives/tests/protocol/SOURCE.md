# Test-only protocol source snapshot

Exact dependency closure of VaultFactory, UniV3Vault and UniV3FullRangeAdapter from saffron-finance/fixed-income commit 9f112e6115816fd8fbe0475ccb59c5f6519416e7. Original MIT/GPL SPDX notices retained. These files are unchanged and compile only in local integration tests; they are not an application or runtime dependency.

Tests deploy this source on an isolated Anvil chain with test-only tokens and a position-manager double. Factory, vault, bearer tokens, full-range adapter, initialization, funding, withdrawal and fixed-deposit calls execute real bytecode. This does not establish equivalence to live deployed bytecode or the live Uniswap position manager. Live operator setup pins independently inspected deployment hashes.
