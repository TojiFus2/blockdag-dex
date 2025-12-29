// SPDX-License-Identifier: MIT
pragma solidity 0.6.6;
pragma experimental ABIEncoderV2;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint256 liquidity);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

library TransferLite {
    function safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TL:TRANSFER_FAILED");
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(success && (data.length == 0 || abi.decode(data, (bool))), "TL:TRANSFER_FROM_FAILED");
    }
}

contract V2RouterLite2 {
    using TransferLite for address;

    address public immutable factory;
    address public immutable WETH;

    struct AddLiquidityETHParams {
        address token;
        uint256 amountTokenDesired;
        uint256 amountTokenMin;
        uint256 amountETHMin;
        address to;
        uint256 deadline;
    }

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "RL2:EXPIRED");
        _;
    }

    receive() external payable {
        // accept native only from WETH during withdraw
        require(msg.sender == WETH, "RL2:ETH_REJECTED");
    }

    constructor(address _factory, address _weth) public {
        require(_factory != address(0) && _weth != address(0), "RL2:ZERO_ADDR");
        factory = _factory;
        WETH = _weth;
    }

    // -----------------------------
    // Utils
    // -----------------------------

    function _sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        require(tokenA != tokenB, "RL2:IDENTICAL");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "RL2:ZERO_TOKEN");
    }

    function _pairFor(address tokenA, address tokenB) internal view returns (address pair) {
        pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
    }

    function _ensurePair(address tokenA, address tokenB) internal returns (address pair) {
        pair = IUniswapV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = IUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
    }

    function _getReservesIfExists(address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        address pair = _pairFor(tokenA, tokenB);
        if (pair == address(0)) return (0, 0);

        (address token0,) = _sortTokens(tokenA, tokenB);
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();

        if (tokenA == token0) {
            reserveA = uint256(r0);
            reserveB = uint256(r1);
        } else {
            reserveA = uint256(r1);
            reserveB = uint256(r0);
        }
    }

    function _getReserves(address tokenA, address tokenB) internal view returns (uint256 reserveA, uint256 reserveB) {
        address pair = _pairFor(tokenA, tokenB);
        require(pair != address(0), "RL2:PAIR_NOT_FOUND");

        (address token0,) = _sortTokens(tokenA, tokenB);
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();

        if (tokenA == token0) {
            reserveA = uint256(r0);
            reserveB = uint256(r1);
        } else {
            reserveA = uint256(r1);
            reserveB = uint256(r0);
        }
    }

    function _quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256 amountB) {
        require(amountA > 0, "RL2:INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "RL2:INSUFFICIENT_LIQ");
        amountB = (amountA * reserveB) / reserveA;
    }

    // fee 0.30% => 997/1000
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        require(amountIn > 0, "RL2:INSUFFICIENT_IN");
        require(reserveIn > 0 && reserveOut > 0, "RL2:INSUFFICIENT_LIQ");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        return numerator / denominator;
    }

    function _swapPair(
        address pair,
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        address recipient
    ) internal {
        (address token0,) = _sortTokens(tokenIn, tokenOut);

        uint256 amount0Out;
        uint256 amount1Out;
        if (tokenOut == token0) {
            amount0Out = amountOut;
            amount1Out = 0;
        } else {
            amount0Out = 0;
            amount1Out = amountOut;
        }

        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, recipient, new bytes(0));
    }

    function _getAmountsOut(uint256 amountIn, address[] memory path) internal view returns (uint256[] memory amounts) {
        require(path.length >= 2, "RL2:PATH_LEN");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;

        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = _getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts) {
        // convenience view for UI / offchain checks
        // NOTE: will revert if any hop pair doesn't exist or has 0 liquidity
        address[] memory mpath = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) {
            mpath[i] = path[i];
        }
        amounts = _getAmountsOut(amountIn, mpath);
    }

    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        // requires: first input already transferred to pair(path[0], path[1])
        for (uint256 i = 0; i < path.length - 1; i++) {
            address input = path[i];
            address output = path[i + 1];
            address pair = _pairFor(input, output);
            require(pair != address(0), "RL2:PAIR_NOT_FOUND");

            address recipient = (i < path.length - 2)
                ? _pairFor(output, path[i + 2])
                : to;

            require(recipient != address(0), "RL2:ROUTE_BROKEN");

            _swapPair(pair, input, output, amounts[i + 1], recipient);
        }
    }

    // -----------------------------
    // Add Liquidity (token/token)
    // -----------------------------

    function _addLiquidityTokens(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal returns (address pair, uint256 amountA, uint256 amountB) {
        require(tokenA != address(0) && tokenB != address(0), "RL2:ZERO_TOKEN");
        require(tokenA != tokenB, "RL2:IDENTICAL");
        require(amountADesired > 0 && amountBDesired > 0, "RL2:ZERO_DESIRED");

        pair = _ensurePair(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) = _getReservesIfExists(tokenA, tokenB);

        if (reserveA == 0 && reserveB == 0) {
            amountA = amountADesired;
            amountB = amountBDesired;
        } else {
            uint256 amountBOptimal = _quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "RL2:INSUFF_B");
                amountA = amountADesired;
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = _quote(amountBDesired, reserveB, reserveA);
                require(amountAOptimal >= amountAMin, "RL2:INSUFF_A");
                amountA = amountAOptimal;
                amountB = amountBDesired;
            }
        }

        require(amountA >= amountAMin, "RL2:INSUFF_A");
        require(amountB >= amountBMin, "RL2:INSUFF_B");
    }

    function _mintLiquidity(
        address pair,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        address to
    ) internal returns (uint256 liquidity) {
        tokenA.safeTransferFrom(msg.sender, pair, amountA);
        tokenB.safeTransferFrom(msg.sender, pair, amountB);
        liquidity = IUniswapV2Pair(pair).mint(to);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(to != address(0), "RL2:ZERO_TO");

        address pair;
        (pair, amountA, amountB) = _addLiquidityTokens(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        liquidity = _mintLiquidity(pair, tokenA, tokenB, amountA, amountB, to);
    }

    // -----------------------------
    // Add Liquidity ETH (STRUCT params => no stack-too-deep)
    // -----------------------------

    function addLiquidityETH(AddLiquidityETHParams calldata p)
        external
        payable
        ensure(p.deadline)
        returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)
    {
        require(p.to != address(0), "RL2:ZERO_TO");
        require(p.amountTokenDesired > 0, "RL2:ZERO_TOKEN_DESIRED");
        require(msg.value > 0, "RL2:ZERO_ETH");

        address pair = _ensurePair(p.token, WETH);

        (uint256 reserveToken, uint256 reserveWeth) = _getReservesIfExists(p.token, WETH);

        if (reserveToken == 0 && reserveWeth == 0) {
            amountToken = p.amountTokenDesired;
            amountETH = msg.value;
        } else {
            uint256 amountETHOptimal = _quote(p.amountTokenDesired, reserveToken, reserveWeth);
            if (amountETHOptimal <= msg.value) {
                require(amountETHOptimal >= p.amountETHMin, "RL2:INSUFF_ETH");
                amountToken = p.amountTokenDesired;
                amountETH = amountETHOptimal;
            } else {
                uint256 amountTokenOptimal = _quote(msg.value, reserveWeth, reserveToken);
                require(amountTokenOptimal >= p.amountTokenMin, "RL2:INSUFF_TOKEN");
                amountToken = amountTokenOptimal;
                amountETH = msg.value;
            }
        }

        p.token.safeTransferFrom(msg.sender, pair, amountToken);

        IWETH(WETH).deposit{value: amountETH}();
        WETH.safeTransfer(pair, amountETH);

        liquidity = IUniswapV2Pair(pair).mint(p.to);

        if (msg.value > amountETH) {
            (bool ok,) = msg.sender.call{value: msg.value - amountETH}("");
            require(ok, "RL2:REFUND_FAIL");
        }
    }

    // -----------------------------
    // Swaps (path length >= 2, supports multihop)
    // -----------------------------

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2, "RL2:PATH_LEN");
        require(to != address(0), "RL2:ZERO_TO");
        require(amountIn > 0, "RL2:ZERO_IN");

        // copy path to memory
        address[] memory mpath = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) mpath[i] = path[i];

        amounts = _getAmountsOut(amountIn, mpath);
        require(amounts[amounts.length - 1] >= amountOutMin, "RL2:INSUFF_OUT");

        address firstPair = _pairFor(mpath[0], mpath[1]);
        require(firstPair != address(0), "RL2:PAIR_NOT_FOUND");

        // send input to first pair
        mpath[0].safeTransferFrom(msg.sender, firstPair, amounts[0]);

        _swap(amounts, mpath, to);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2, "RL2:PATH_LEN");
        require(path[0] == WETH, "RL2:PATH_WETH_IN");
        require(to != address(0), "RL2:ZERO_TO");
        require(msg.value > 0, "RL2:ZERO_ETH");

        address[] memory mpath = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) mpath[i] = path[i];

        amounts = _getAmountsOut(msg.value, mpath);
        require(amounts[amounts.length - 1] >= amountOutMin, "RL2:INSUFF_OUT");

        address firstPair = _pairFor(mpath[0], mpath[1]);
        require(firstPair != address(0), "RL2:PAIR_NOT_FOUND");

        // wrap and send to first pair
        IWETH(WETH).deposit{value: msg.value}();
        WETH.safeTransfer(firstPair, amounts[0]);

        _swap(amounts, mpath, to);
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2, "RL2:PATH_LEN");
        require(path[path.length - 1] == WETH, "RL2:PATH_WETH_OUT");
        require(to != address(0), "RL2:ZERO_TO");
        require(amountIn > 0, "RL2:ZERO_IN");

        address[] memory mpath = new address[](path.length);
        for (uint256 i = 0; i < path.length; i++) mpath[i] = path[i];

        amounts = _getAmountsOut(amountIn, mpath);
        require(amounts[amounts.length - 1] >= amountOutMin, "RL2:INSUFF_OUT");

        address firstPair = _pairFor(mpath[0], mpath[1]);
        require(firstPair != address(0), "RL2:PAIR_NOT_FOUND");

        // transfer tokenIn to first pair
        mpath[0].safeTransferFrom(msg.sender, firstPair, amounts[0]);

        // final WETH goes to this router, then unwrap and send native
        _swap(amounts, mpath, address(this));

        uint256 amountWethOut = amounts[amounts.length - 1];
        IWETH(WETH).withdraw(amountWethOut);
        (bool ok,) = to.call{value: amountWethOut}("");
        require(ok, "RL2:ETH_SEND_FAIL");
    }
}
