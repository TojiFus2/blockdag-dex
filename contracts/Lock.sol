// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @dev Questo file non è usato dal DEX. Serve solo per evitare che Hardhat
 * fallisca la compile se Lock.sol era stato “sporcato” da output di console.
 */
contract Lock {
    uint256 public unlockTime;
    address payable public owner;

    event Withdrawal(uint256 amount, uint256 when);

    constructor(uint256 _unlockTime) payable {
        require(_unlockTime > block.timestamp, "unlock time should be in the future");
        unlockTime = _unlockTime;
        owner = payable(msg.sender);
    }

    function withdraw() external {
        require(block.timestamp >= unlockTime, "too early");
        require(msg.sender == owner, "not owner");

        uint256 amount = address(this).balance;
        emit Withdrawal(amount, block.timestamp);

        owner.transfer(amount);
    }
}
