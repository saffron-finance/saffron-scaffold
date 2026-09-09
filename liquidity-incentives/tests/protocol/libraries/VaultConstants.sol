// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

/// @title Vault Constants
/// @notice Shared constants used across vault and adapter contracts
library VaultConstants {
  /// @notice Fixed side identifier
  uint256 internal constant FIXED = 0;

  /// @notice Variable side identifier
  uint256 internal constant VARIABLE = 1;

  /// @notice Maximum basis points value (100%)
  uint256 internal constant MAX_BPS = 10_000;
}
