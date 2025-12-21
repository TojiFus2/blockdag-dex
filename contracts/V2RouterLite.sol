// SPDX-License-Identifier: MIT
pragma solidity 0.5.16;

interface IERC20 {
    function balanceOf(address) external view returns (uint);
    function transfer(address to, uint value) external returns (bool);
    function approve(address spender, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);

    function getReserves()
        external
        view
        returns (
            uint112 reserve0,
            uint112 reserve1,
            uint32 blockTimestampLast
        );

    function mint(address to) external returns (uint liquidity);

    function swap(
        uint amount0Out,
        uint amount1Out,
        address to,
        bytes calldata data
    ) external;
}

library SafeMathLite {
    function add(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x, "add overflow");
    }

    function sub(uint x, uint y) internal pure returns (uint z) {
        require((z = x - y) <= x, "sub underflow");
    }

    function mul(uint x, uint y) internal pure returns (uint z) {
        if (x == 0) return 0;
        require((z = x * y) / x == y, "mul overflow");
    }
}

contract V2RouterLite {
    using SafeMathLite for uint;

    address public factory;

    event PairUsed(address indexed tokenA, address indexed tokenB, address pair);
    event LiquidityAdded(address indexed pair, uint amountA, uint amountB, uint liquidityMinted);
    event SwapDone(
        address indexed pair,
        address indexed tokenIn,
        address indexed tokenOut,
        uint amountIn,
        uint amountOut
    );

    constructor(address _factory) public {
        require(_factory != address(0), "factory=0");
        factory = _factory;
    }

    // ===== INTERNAL HELPERS =====

    function _pairFor(address tokenA, address tokenB) internal returns (address pair) {
        pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = IUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
        require(pair != address(0), "pair=0");
        emit PairUsed(tokenA, tokenB, pair);
    }

    function _getReserves(
        address pair,
        address tokenA,
        address tokenB
    ) internal view returns (uint reserveA, uint reserveB) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        address t0 = IUniswapV2Pair(pair).token0();
        if (tokenA == t0) {
            reserveA = uint(r0);
            reserveB = uint(r1);
        } else {
            reserveA = uint(r1);
            reserveB = uint(r0);
        }
    }

    function _getAmountOut(
        uint amountIn,
        uint reserveIn,
        uint reserveOut
    ) internal pure returns (uint amountOut) {
        require(amountIn > 0, "amountIn=0");
        require(reserveIn > 0 && reserveOut > 0, "no-liquidity");

        // Uniswap V2 formula with 0.3% fee
        uint amountInWithFee = amountIn.mul(997);
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = numerator / denominator;
    }

    // ===== PUBLIC API =====

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountA,
        uint amountB,
        address to
    ) external returns (address pair, uint liquidity) {
        require(to != address(0), "to=0");
        require(amountA > 0 && amountB > 0, "amounts=0");

        pair = _pairFor(tokenA, tokenB);

        require(IERC20(tokenA).transferFrom(msg.sender, pair, amountA), "transferA fail");
        require(IERC20(tokenB).transferFrom(msg.sender, pair, amountB), "transferB fail");

        liquidity = IUniswapV2Pair(pair).mint(to);

        emit LiquidityAdded(pair, amountA, amountB, liquidity);
    }

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint amountIn,
        uint amountOutMin,
        address to
    ) external returns (address pair, uint amountOut) {
        require(to != address(0), "to=0");
        require(amountIn > 0, "amountIn=0");

        pair = IUniswapV2Factory(factory).getPair(tokenIn, tokenOut);
        require(pair != address(0), "pair missing");

        (uint reserveIn, uint reserveOut) = _getReserves(pair, tokenIn, tokenOut);

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= amountOutMin, "slippage");

        require(IERC20(tokenIn).transferFrom(msg.sender, pair, amountIn), "transferIn fail");

        address t0 = IUniswapV2Pair(pair).token0();
        (uint amount0Out, uint amount1Out) = tokenIn == t0
            ? (uint(0), amountOut)
            : (amountOut, uint(0));

        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, to, new bytes(0));

        emit SwapDone(pair, tokenIn, tokenOut, amountIn, amountOut);
    }
}
