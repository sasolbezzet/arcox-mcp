// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IArcoxBTCPool {
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256);
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut) external returns (uint256);
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title ArcoxCirBTCRouterV2
/// @notice Routes cirBTC swaps through USDC-cirBTC AMM pool only.
///         EURC<->cirBTC is a 2-hop multicall: EURC->USDC (external adapter) then USDC->cirBTC (AMM).
///         This guarantees rate consistency — all cirBTC liquidity comes from one pool.
///         Platform fee: 30 bps to treasury on every swap.
contract ArcoxCirBTCRouterV2 {
    address public treasury;
    address public immutable USDC;
    address public immutable EURC;
    address public immutable CIRBTC;
    address public usdcCirBtcPool;   // USDC-cirBTC AMM pool
    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS_DENOM = 10000;

    // External adapter for EURC<->USDC swaps (Circle AppKit adapter)
    // set to address(0) to disable EURC<->cirBTC route
    address public eurcUsdcAdapter;
    bytes4 public constant ADAPTER_EXECUTE_SELECTOR = 0x6a76ef36; // execute((...))

    event PoolRegistered(address indexed token0, address indexed token1, address pool);
    event TreasuryUpdated(address newTreasury);
    event AdapterUpdated(address newAdapter);

    constructor(address _treasury, address _usdc, address _eurc, address _cirbtc) {
        treasury = _treasury;
        USDC = _usdc;
        EURC = _eurc;
        CIRBTC = _cirbtc;
    }

    function registerPool(address tokenA, address tokenB, address pool) external {
        require(msg.sender == treasury, "only treasury");
        bool isUsdcCirBtc = (tokenA == USDC && tokenB == CIRBTC) || (tokenA == CIRBTC && tokenB == USDC);
        require(isUsdcCirBtc, "only USDC-cirBTC pool supported");
        usdcCirBtcPool = pool;
        emit PoolRegistered(tokenA, tokenB, pool);
    }

    function setTreasury(address newTreasury) external {
        require(msg.sender == treasury, "only treasury");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setEurcUsdcAdapter(address adapter) external {
        require(msg.sender == treasury, "only treasury");
        eurcUsdcAdapter = adapter;
        emit AdapterUpdated(adapter);
    }

    // ── AMM math (x*y=k, 0.3% fee internal) ──
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0) return 0;
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        return numerator / denominator;
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        // Direct USDC<->cirBTC: single hop through AMM
        if ((tokenIn == USDC && tokenOut == CIRBTC) || (tokenIn == CIRBTC && tokenOut == USDC)) {
            (uint256 r0, uint256 r1) = IArcoxBTCPool(usdcCirBtcPool).getReserves();
            address t0 = IArcoxBTCPool(usdcCirBtcPool).token0();
            if (tokenIn == t0) return _getAmountOut(amountIn, r0, r1);
            return _getAmountOut(amountIn, r1, r0);
        }
        // EURC -> cirBTC: EURC -> USDC (not handled on-chain, returns 0)
        // cirBTC -> EURC: cirBTC -> USDC (not handled on-chain, returns 0)
        // These paths need external routing; on-chain getAmountOut returns 0 for quote-only
        return 0;
    }

    /// @notice Swap USDC<->cirBTC directly through AMM with platform fee
    function swapWithFee(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) external returns (uint256) {
        require((tokenIn == USDC && tokenOut == CIRBTC) || (tokenIn == CIRBTC && tokenOut == USDC), "only USDC<->cirBTC direct");
        require(amountIn > 0, "zero amount");

        // Transfer fee to treasury first
        uint256 feeAmount = amountIn * FEE_BPS / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        require(IERC20(tokenIn).transferFrom(msg.sender, treasury, feeAmount), "fee transfer failed");

        // Transfer swap amount to pool
        require(IERC20(tokenIn).transferFrom(msg.sender, usdcCirBtcPool, swapAmount), "pool transfer failed");

        // Execute swap in pool — pool sends tokenOut to this router
        uint256 amountOut = IArcoxBTCPool(usdcCirBtcPool).swap(tokenIn, swapAmount, minAmountOut);

        // Forward output to caller
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "output transfer failed");

        return amountOut;
    }

    /// @notice Quote for EURC->cirBTC (2-hop). Returns estimated cirBTC output.
    /// @dev Caller must provide the USDC intermediate amount from external EURC->USDC quote.
    function getEurcToCirBtcAmountOut(uint256 usdcIntermediateAmount) external view returns (uint256) {
        (uint256 r0, uint256 r1) = IArcoxBTCPool(usdcCirBtcPool).getReserves();
        address t0 = IArcoxBTCPool(usdcCirBtcPool).token0();
        if (USDC == t0) return _getAmountOut(usdcIntermediateAmount, r0, r1);
        return _getAmountOut(usdcIntermediateAmount, r1, r0);
    }

    /// @notice Quote for cirBTC->EURC (2-hop). Returns estimated USDC intermediate output.
    function getCirBtcToUsdcAmountOut(uint256 cirbtcAmountIn) external view returns (uint256) {
        (uint256 r0, uint256 r1) = IArcoxBTCPool(usdcCirBtcPool).getReserves();
        address t0 = IArcoxBTCPool(usdcCirBtcPool).token0();
        if (CIRBTC == t0) return _getAmountOut(cirbtcAmountIn, r0, r1);
        return _getAmountOut(cirbtcAmountIn, r1, r0);
    }

    /// @notice Execute cirBTC->USDC hop (for 2-leg cirBTC->EURC route).
    ///         Caller then does USDC->EURC externally.
    function swapCirBtcToUsdc(uint256 amountIn, uint256 minAmountOut) external returns (uint256) {
        return _swapUsdcCirBtc(CIRBTC, USDC, amountIn, minAmountOut);
    }

    /// @notice Execute USDC->cirBTC hop (for 2-leg EURC->cirBTC route).
    ///         Caller does EURC->USDC externally first.
    function swapUsdcToCirBtc(uint256 amountIn, uint256 minAmountOut) external returns (uint256) {
        return _swapUsdcCirBtc(USDC, CIRBTC, amountIn, minAmountOut);
    }

    function _swapUsdcCirBtc(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut) internal returns (uint256) {
        require(amountIn > 0, "zero amount");
        uint256 feeAmount = amountIn * FEE_BPS / BPS_DENOM;
        uint256 swapAmount = amountIn - feeAmount;
        require(IERC20(tokenIn).transferFrom(msg.sender, treasury, feeAmount), "fee transfer failed");
        require(IERC20(tokenIn).transferFrom(msg.sender, usdcCirBtcPool, swapAmount), "pool transfer failed");
        uint256 amountOut = IArcoxBTCPool(usdcCirBtcPool).swap(tokenIn, swapAmount, minAmountOut);
        require(IERC20(tokenOut).transfer(msg.sender, amountOut), "output transfer failed");
        return amountOut;
    }
}
