// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./vendor/@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "./vendor/@uniswap/v3-core/contracts/libraries/TickMath.sol";

/// Test-only token. Never deployed by the application worker.
contract FixtureToken is ERC20 {
  constructor() ERC20("Fixture token", "FIX") {}
  function mint(address to, uint256 amount) external { _mint(to, amount); }
  function deposit() external payable { _mint(msg.sender, msg.value); }
}
/// Test-only pool with a deterministic exchange rate and full-range fee spacing.
contract FixturePool {
  address public immutable token0; address public immutable token1;
  uint24 public constant fee = 10000; int24 public constant tickSpacing = 200;
  constructor(address t0,address t1) { token0=t0;token1=t1; }
  function slot0() external pure returns(uint160,int24,uint16,uint16,uint16,uint8,bool) {
    return(uint160((uint256(1)<<96)/1000),0,0,0,0,0,true);
  }
}
interface FixtureAdapter { function vaultAddress() external view returns(address); }
interface FixtureVault { function fixedSideCapacity() external view returns(uint256); }
/// Position-manager double only; all Saffron contracts remain original bytecode.
contract FixturePositionManager {
  address public immutable pool;
  constructor(address p) {pool=p;}
  function factory() external view returns(address) {return address(this);}
  function getPool(address,address,uint24) external view returns(address) {return pool;}
  struct MintParams {address token0;address token1;uint24 fee;int24 tickLower;int24 tickUpper;uint256 amount0Desired;uint256 amount1Desired;uint256 amount0Min;uint256 amount1Min;address recipient;uint256 deadline;}
  function mint(MintParams calldata p) external returns(uint256,uint128,uint256,uint256) {
    require(block.timestamp<=p.deadline,"expired");
    require(p.amount0Desired>=p.amount0Min && p.amount1Desired>=p.amount1Min,"slippage");
    require(IERC20(p.token0).transferFrom(msg.sender,address(this),p.amount0Desired));
    require(IERC20(p.token1).transferFrom(msg.sender,address(this),p.amount1Desired));
    return(1,uint128(FixtureVault(FixtureAdapter(msg.sender).vaultAddress()).fixedSideCapacity()),p.amount0Desired,p.amount1Desired);
  }
  function amounts(uint128 liquidity,uint160 price,int24 low,int24 high) external pure returns(uint256,uint256) {
    return LiquidityAmounts.getAmountsForLiquidity(price,TickMath.getSqrtRatioAtTick(low),TickMath.getSqrtRatioAtTick(high),liquidity);
  }
}
