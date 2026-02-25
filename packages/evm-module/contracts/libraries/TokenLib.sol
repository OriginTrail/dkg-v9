// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

library TokenLib {
    error ZeroTokenAmount();
    error TooLowAllowance(address tokenAddress, uint256 allowance, uint256 expected);
    error TooLowBalance(address tokenAddress, uint256 balance, uint256 expected);
    error TransferFailed();
}
