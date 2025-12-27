// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// Minimal mintable ERC20-style token (USDT-like) for testnet demos.
contract MockWUSDT {
    string public name = "Wrapped USD Tether";
    string public symbol = "WUSDT";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "WUSDT:NOT_OWNER");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "WUSDT:ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        require(to != address(0), "WUSDT:ZERO_TO");
        uint256 b = balanceOf[msg.sender];
        require(b >= value, "WUSDT:INSUFF_BAL");
        unchecked { balanceOf[msg.sender] = b - value; }
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        require(spender != address(0), "WUSDT:ZERO_SPENDER");
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        require(to != address(0), "WUSDT:ZERO_TO");
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "WUSDT:INSUFF_ALLOW");
        uint256 b = balanceOf[from];
        require(b >= value, "WUSDT:INSUFF_BAL");

        unchecked {
            allowance[from][msg.sender] = a - value;
            balanceOf[from] = b - value;
        }
        balanceOf[to] += value;

        emit Transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external onlyOwner {
        require(to != address(0), "WUSDT:ZERO_TO");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }
}

