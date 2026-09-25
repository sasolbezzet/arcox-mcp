
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IArcoxBTCPool {
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256);
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256);
    function getReserves() external view returns (uint256, uint256);
}

/// @title ArcoxCirBTCRouter — Router with platform fee for cirBTC AMM swaps
/// @notice Charges 30 bps platform fee to treasury, then swaps via pool
contract ArcoxCirBTCRouter {
    address public treasury;
    uint256 public constant PLATFORM_FEE_BPS = 30; // 0.3%
    uint256 public constant FEE_DENOM = 10000;

    // token0 => token1 => pool address
    mapping(address => mapping(address => address)) public pools;

    event PoolRegistered(address token0, address token1, address pool);
    event SwapWithFee(address sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 feeAmount, uint256 amountSwapped, uint256 amountOut);

    constructor(address _treasury) {
        treasury = _treasury;
    }

    function registerPool(address token0, address token1, address pool) external {
        pools[token0][token1] = pool;
        pools[token1][token0] = pool;
        emit PoolRegistered(token0, token1, pool);
    }

    function getPool(address tokenIn, address tokenOut) public view returns (address) {
        return pools[tokenIn][tokenOut];
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        address pool = pools[tokenIn][tokenOut];
        require(pool != address(0), "No pool for this pair");

        // Calculate fee
        uint256 feeAmount = (amountIn * PLATFORM_FEE_BPS) / FEE_DENOM;
        uint256 amountAfterFee = amountIn - feeAmount;

        // Get quote from pool
        uint256 poolOut = IArcoxBTCPool(pool).getAmountOut(tokenIn, amountAfterFee);
        return poolOut;
    }

    function swapWithFee(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut) {
        address pool = pools[tokenIn][tokenOut];
        require(pool != address(0), "No pool for this pair");
        require(amountIn > 0, "Zero amount");

        // Transfer token in from user to router
        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "Transfer in failed");

        // Calculate and transfer platform fee
        uint256 feeAmount = (amountIn * PLATFORM_FEE_BPS) / FEE_DENOM;
        if (feeAmount > 0 && treasury != address(0)) {
            require(IERC20(tokenIn).transfer(treasury, feeAmount), "Fee transfer failed");
        }

        uint256 amountAfterFee = amountIn - feeAmount;

        // Approve pool to spend
        IERC20(tokenIn).approve(pool, amountAfterFee);

        // Swap via pool
        uint256 poolAmountOut = IArcoxBTCPool(pool).swap(tokenIn, amountAfterFee, 0);

        // Check slippage
        require(poolAmountOut >= minAmountOut, "Slippage exceeded");

        // Transfer output to user
        require(IERC20(tokenOut).transfer(msg.sender, poolAmountOut), "Transfer out failed");

        emit SwapWithFee(msg.sender, tokenIn, tokenOut, amountIn, feeAmount, amountAfterFee, poolAmountOut);
        return poolAmountOut;
    }

    function getReserves(address token0, address token1) external view returns (uint256, uint256) {
        address pool = pools[token0][token1];
        require(pool != address(0), "No pool");
        return IArcoxBTCPool(pool).getReserves();
    }
}
