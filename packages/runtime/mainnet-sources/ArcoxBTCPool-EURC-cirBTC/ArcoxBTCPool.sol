
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title ArcoxBTCPool — Constant product AMM (x*y=k) for cirBTC pairs
/// @notice Simple Uniswap V2-style pool with 0.3% swap fee
contract ArcoxBTCPool {
    address public token0;
    address public token1;
    uint8 public decimals0;
    uint8 public decimals1;

    uint256 public reserve0;
    uint256 public reserve1;

    uint256 public constant FEE_BPS = 30; // 0.3%
    uint256 public constant FEE_DENOM = 10000;

    mapping(address => uint256) public lpBalance;
    uint256 public totalLpSupply;

    event LiquidityAdded(address provider, uint256 amount0, uint256 amount1, uint256 lpMinted);
    event LiquidityRemoved(address provider, uint256 amount0Out, uint256 amount1Out, uint256 lpBurned);
    event Swap(address sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
        decimals0 = IERC20(_token0).decimals();
        decimals1 = IERC20(_token1).decimals();
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external returns (uint256 lpMinted) {
        require(amount0 > 0 && amount1 > 0, "Zero amount");
        require(IERC20(token0).transferFrom(msg.sender, address(this), amount0), "T0 transfer failed");
        require(IERC20(token1).transferFrom(msg.sender, address(this), amount1), "T1 transfer failed");

        if (totalLpSupply == 0) {
            lpMinted = sqrt(amount0 * amount1);
        } else {
            uint256 lp0 = (amount0 * totalLpSupply) / reserve0;
            uint256 lp1 = (amount1 * totalLpSupply) / reserve1;
            lpMinted = lp0 < lp1 ? lp0 : lp1;
        }

        require(lpMinted > 0, "Insufficient liquidity minted");
        lpBalance[msg.sender] += lpMinted;
        totalLpSupply += lpMinted;
        reserve0 += amount0;
        reserve1 += amount1;

        emit LiquidityAdded(msg.sender, amount0, amount1, lpMinted);
    }

    function removeLiquidity(uint256 lpAmount) external returns (uint256 amount0Out, uint256 amount1Out) {
        require(lpAmount > 0 && lpBalance[msg.sender] >= lpAmount, "Insufficient LP");
        lpBalance[msg.sender] -= lpAmount;

        amount0Out = (lpAmount * reserve0) / totalLpSupply;
        amount1Out = (lpAmount * reserve1) / totalLpSupply;

        totalLpSupply -= lpAmount;
        reserve0 -= amount0Out;
        reserve1 -= amount1Out;

        require(IERC20(token0).transfer(msg.sender, amount0Out), "T0 transfer out failed");
        require(IERC20(token1).transfer(msg.sender, amount1Out), "T1 transfer out failed");

        emit LiquidityRemoved(msg.sender, amount0Out, amount1Out, lpAmount);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        require(tokenIn == token0 || tokenIn == token1, "Invalid token");
        require(amountIn > 0, "Zero input");

        uint256 amountInWithFee = (amountIn * (FEE_DENOM - FEE_BPS)) / FEE_DENOM;

        if (tokenIn == token0) {
            // token0 → token1
            // Handle different decimals: normalize to common base
            if (decimals0 == decimals1) {
                return (amountInWithFee * reserve1) / (reserve0 + amountInWithFee);
            } else {
                // Normalize: scale amount0 to decimals1
                uint256 amountInNormalized = amountInWithFee * (10 ** (decimals1 - decimals0 > 0 ? decimals1 - decimals0 : 0));
                uint256 reserve0Normalized = reserve0 * (10 ** (decimals1 - decimals0 > 0 ? decimals1 - decimals0 : 0));
                return (amountInNormalized * reserve1) / (reserve0Normalized + amountInNormalized);
            }
        } else {
            // token1 → token0
            if (decimals0 == decimals1) {
                return (amountInWithFee * reserve0) / (reserve1 + amountInWithFee);
            } else {
                uint256 amountInNormalized = amountInWithFee;
                uint256 reserve1Normalized = reserve1;
                if (decimals0 > decimals1) {
                    // scale token1 amount to decimals0
                    amountInNormalized = amountInWithFee * (10 ** (decimals0 - decimals1));
                    reserve1Normalized = reserve1 * (10 ** (decimals0 - decimals1));
                }
                return (amountInNormalized * reserve0) / (reserve1Normalized + amountInNormalized);
            }
        }
    }

    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        require(tokenIn == token0 || tokenIn == token1, "Invalid token");
        require(amountIn > 0, "Zero input");

        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Transfer in failed");

        amountOut = getAmountOut(tokenIn, amountIn);
        require(amountOut >= minAmountOut, "Slippage exceeded");

        address tokenOut = tokenIn == token0 ? token1 : token0;
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "Transfer out failed");

        // Update reserves
        if (tokenIn == token0) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    function getReserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
