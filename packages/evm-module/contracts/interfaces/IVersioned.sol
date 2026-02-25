// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

interface IVersioned {
    function version() external view returns (string memory);
}
