// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

interface ICustodian {
    function getOwners() external view returns (address[] memory);
}
