// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

interface IERC1155DeltaQueryable {
    error InvalidQueryRange();

    function balanceOf(address owner) external view returns (uint256);

    function balanceOf(address owner, uint256 start, uint256 stop) external view returns (uint256);

    function tokensOfOwnerIn(address owner, uint256 start, uint256 stop) external view returns (uint256[] memory);

    function tokensOfOwner(address owner) external view returns (uint256[] memory);
}
