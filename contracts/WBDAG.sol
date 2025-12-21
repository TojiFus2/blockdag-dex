// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * @dev Placeholder. In testnet usiamo WBDAG ufficiale da env (WBDAG_OFFICIAL).
 * Questo file serve solo a non rompere la compile se esisteva un pragma ^0.8.28.
 */
interface IWBDAG {
    function deposit() external payable;
    function withdraw(uint256) external;
}
