// SPDX-License-Identifier: MIT

pragma solidity 0.8.18;

import "./UniV3LimitedRangeAdapter.sol";

/// @title Saffron Fixed Income Uniswap V3 Full Range Adapter
/// @author psykeeper, supafreq, everywherebagel, maze, rx
/// @notice Adapter that connects a Uniswap V3 pool to a UniV3Vault, using a full price range
contract UniV3FullRangeAdapter is UniV3LimitedRangeAdapter {
  constructor(INonfungiblePositionManager _positionManager) UniV3LimitedRangeAdapter(_positionManager) {}

  /// @inheritdoc IAdapter
  function initialize(
    uint256 _id,
    address _pool,
    uint256 _depositTolerance,
    bytes memory _unused
  ) virtual public override onlyWithoutVaultAttached onlyFactory {
    require(_pool != address(0), "NEI");
    require(_unused.length == 0, "OEI");

    int24 ts = IUniswapV3Pool(_pool).tickSpacing();

    // Tick bitmap requires ticks are spaced
    // See flipTick(...) from v3-core/contracts/libraries/TickBitmap.sol
    UniV3InitData memory params = UniV3InitData({
      minTick: TickMath.MIN_TICK - (TickMath.MIN_TICK % ts),
      maxTick: TickMath.MAX_TICK - (TickMath.MAX_TICK % ts)
    });

    bytes memory sData = abi.encode(params);
    super.initialize(_id, _pool, _depositTolerance, sData);
  }
}
