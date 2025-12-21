// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IMintableERC20 {
    function mint(address to, uint256 value) external;
}

contract TokenFaucet {
    address public owner;
    address public token; // MockUSDC
    uint256 public dripAmount; // in token raw units (USDC has 6 decimals)
    uint256 public cooldown; // seconds

    mapping(address => uint256) public lastDripAt;

    event Dripped(address indexed to, uint256 amount);
    event ConfigChanged(address token, uint256 dripAmount, uint256 cooldown);

    modifier onlyOwner() {
        require(msg.sender == owner, "Faucet:NOT_OWNER");
        _;
    }

    constructor(address _token, uint256 _dripAmount, uint256 _cooldown) {
        require(_token != address(0), "Faucet:ZERO_TOKEN");
        owner = msg.sender;
        token = _token;
        dripAmount = _dripAmount;
        cooldown = _cooldown;
        emit ConfigChanged(_token, _dripAmount, _cooldown);
    }

    function setConfig(address _token, uint256 _dripAmount, uint256 _cooldown) external onlyOwner {
        require(_token != address(0), "Faucet:ZERO_TOKEN");
        token = _token;
        dripAmount = _dripAmount;
        cooldown = _cooldown;
        emit ConfigChanged(_token, _dripAmount, _cooldown);
    }

    function drip() external {
        uint256 last = lastDripAt[msg.sender];
        require(block.timestamp >= last + cooldown, "Faucet:COOLDOWN");
        lastDripAt[msg.sender] = block.timestamp;

        IMintableERC20(token).mint(msg.sender, dripAmount);
        emit Dripped(msg.sender, dripAmount);
    }
}
