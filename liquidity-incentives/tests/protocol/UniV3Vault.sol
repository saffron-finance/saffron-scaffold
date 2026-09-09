// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "./Vault.sol";
import "./interfaces/IUniV3Adapter.sol";
import "./libraries/VaultConstants.sol";

/// @title Saffron Fixed Income Uniswap V3 Vault
/// @author psykeeper, supafreq, everywherebagel, maze, rx
/// @notice Vault implementation that supports Uniswap V3 adapters
contract UniV3Vault is Vault, IUniV3Vault {
  using SafeERC20 for IERC20;

  /// @notice token0 earnings
  uint256 public earnings0;

  /// @notice token1 earnings
  uint256 public earnings1;

  /// @notice Deposit assets into the vault
  /// @param amount Amount of asset to deposit
  /// @param side ID of side to deposit into
  /// @param deployCapitalData Data passed to adapter's deployCapital(), ultimately used to call Uniswap V3's PositionManager#mint()
  function deposit(
    uint256 amount,
    uint256 side,
    bytes calldata deployCapitalData
  ) public override isInitialized nonReentrant {
    require(!isStarted, "DAS");
    require(side == VaultConstants.FIXED || side == VaultConstants.VARIABLE, "IS");

    if (side == VaultConstants.VARIABLE) {
      // Variable side deposits

      uint256 minAmount = 0;
      if (deployCapitalData.length > 0) {
        // Decode minimum amount from deployCapitalData
        minAmount = abi.decode(deployCapitalData, (uint256));
      }

      // Deposit only up to capacity
      uint256 totalSupply = variableBearerToken.totalSupply();
      if (amount + totalSupply > variableSideCapacity) {
        amount = variableSideCapacity - totalSupply;
      }
      require(amount > 0, "NZD");
      require(amount >= minAmount, "IAM"); // Insufficient Amount for Minimum

      // Transfer (restricted to non-deflationary tokens)
      uint256 oldBalance = IERC20(variableAsset).balanceOf(address(this));
      IERC20(variableAsset).safeTransferFrom(msg.sender, address(this), amount);
      uint256 newBalance = IERC20(variableAsset).balanceOf(address(this));
      require(amount == newBalance - oldBalance, "NDT");

      // Mint bearer tokens
      variableBearerToken.mint(msg.sender, amount);

      uint256[] memory amounts = new uint256[](1);
      amounts[0] = amount;
      emit FundsDeposited(amounts, side, msg.sender);
    } else {
      // Fixed Side deposits

      require(deployCapitalData.length > 0, "NEI");
      require(amount == 0, "OZD");
      require(claimToken.totalSupply() == 0, "CTM");

      // Add liquidity to Uniswap V3 and mint claim token
      (uint256 amount0, uint256 amount1) = IUniV3Adapter(address(adapter)).deployCapital(msg.sender, deployCapitalData);
      claimToken.mint(msg.sender, 1);

      uint256[] memory amounts = new uint256[](2);
      amounts[0] = amount0;
      amounts[1] = amount1;
      emit FundsDeposited(amounts, side, msg.sender);
    }

    // Start the vault if we're at capacity
    if (claimToken.totalSupply() == 1 && variableBearerToken.totalSupply() == variableSideCapacity) {
      _start();
    }
  }

  /// @notice Withdraw assets from the vault
  /// @param side ID of side to withdraw from
  /// @param removeLiquidityData Data that is ultimately used to call Uniswap V3's PositionManager#decreaseLiquidity()
  function withdraw(uint256 side, bytes calldata removeLiquidityData) public override isInitialized nonReentrant {
    require(side == VaultConstants.FIXED || side == VaultConstants.VARIABLE, "IS");

    IUniV3Adapter uniV3Adapter = IUniV3Adapter(address(adapter));

    if (!isStarted && side == VaultConstants.FIXED) {
      // Early withdrawal - Fixed side

      require(removeLiquidityData.length > 0, "NEI");

      // Burn claim token and return liquidity back to depositor
      uint256 amount = claimToken.balanceOf(msg.sender);
      require(amount > 0, "NCT");
      claimToken.burn(msg.sender, amount);
      (uint256 amount0, uint256 amount1) = uniV3Adapter.earlyReturnCapital(msg.sender, side, removeLiquidityData);

      _logFundsWithdrawn(VaultConstants.FIXED, amount0, amount1, true);
      return;
    }

    if (!isStarted && side == VaultConstants.VARIABLE) {
      // Early withdrawal - Variable side

      require(removeLiquidityData.length == 0, "OEI");

      // Burn bearer tokens and return assets back to depositor
      uint256 amount = variableBearerToken.balanceOf(msg.sender);
      variableBearerToken.burn(msg.sender, amount);
      IERC20(variableAsset).safeTransfer(msg.sender, amount);

      _logFundsWithdrawn(VaultConstants.VARIABLE, amount, true);
      return;
    }

    require(isStarted && block.timestamp > endTime, "WBE");

    uint256 amount0;
    uint256 amount1;

    if (side == VaultConstants.FIXED) {
      // Normal withdrawal - Fixed side

      require(removeLiquidityData.length > 0, "NEI");

      uint256 bearerBalance = fixedBearerToken.balanceOf(msg.sender);
      require(bearerBalance > 0, "NFS");

      // Settle earnings if they haven't been settled yet and mint bearer tokens to the feeReceiver
      _settleEarnings(uniV3Adapter);

      // Burn bearer token and return liquidity back to depositor
      (amount0, amount1) = uniV3Adapter.removeLiquidity(msg.sender, removeLiquidityData);
      uniV3Adapter.returnCapital(msg.sender, amount0, amount1, side);
      fixedBearerToken.burn(msg.sender, bearerBalance);

      _logFundsWithdrawn(VaultConstants.FIXED, amount0, amount1, false);
      return;
    }

    if (side == VaultConstants.VARIABLE) {
      // Normal withdrawal - Variable side

      require(removeLiquidityData.length == 0, "OEI");

      // Caller must be a variable side depositor or feeReceiver
      uint256 bearerFeeBalance = 0;
      uint256 bearerBalance = variableBearerToken.balanceOf(msg.sender);
      require(bearerBalance > 0 || (msg.sender == feeReceiver() && variableBearerToken.totalSupply() != 0), "NVS");

      // Settle earnings if they haven't been settled yet and mint bearer tokens to the feeReceiver
      _settleEarnings(uniV3Adapter);

      // If caller is the current feeReceiver, include vault-held fee tokens
      if (msg.sender == feeReceiver()) {
        bearerFeeBalance = variableBearerToken.balanceOf(address(this));
      }

      // Return proportional share of Uniswap V3 fees to caller
      amount0 = FullMath.mulDiv(bearerBalance + bearerFeeBalance, earnings0, variableBearerToken.totalSupply());
      amount1 = FullMath.mulDiv(bearerBalance + bearerFeeBalance, earnings1, variableBearerToken.totalSupply());
      earnings0 -= amount0;
      earnings1 -= amount1;
      uniV3Adapter.returnCapital(msg.sender, amount0, amount1, side);

      // Burn fee tokens if caller is feeReceiver
      if (msg.sender == feeReceiver() && bearerFeeBalance > 0) {
        variableBearerToken.burn(address(this), bearerFeeBalance);
      }

      // Burn user's bearer tokens
      if (bearerBalance > 0) {
        variableBearerToken.burn(msg.sender, bearerBalance);
      }

      _logFundsWithdrawn(VaultConstants.VARIABLE, amount0, amount1, false);
      return;
    }
  }

  /// @dev Helper function for logging an array with length 1
  function _logFundsWithdrawn(uint256 side, uint256 amount0, bool isEarly) internal {
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = amount0;
    emit FundsWithdrawn(amounts, side, msg.sender, isEarly);
  }

  /// @dev Helper function for logging an array with length 2
  function _logFundsWithdrawn(uint256 side, uint256 amount0, uint256 amount1, bool isEarly) internal {
    uint256[] memory amounts = new uint256[](2);
    amounts[0] = amount0;
    amounts[1] = amount1;
    emit FundsWithdrawn(amounts, side, msg.sender, isEarly);
  }

  /// @dev Helper function to settle earnings if not already settled
  function _settleEarnings(IUniV3Adapter uniV3Adapter) internal {
    if (!earningsSettled) {
      (earnings0, earnings1) = uniV3Adapter.settleEarnings();
      earningsSettled = true;
      _applyFee();
      emit VaultEnded(block.timestamp, msg.sender);
    }
  }
}
