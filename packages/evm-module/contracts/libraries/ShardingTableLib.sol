// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

library ShardingTableLib {
    uint72 public constant NULL = 0;

    struct Node {
        uint256 hashRingPosition;
        bytes nodeId;
        uint72 index;
        uint72 identityId;
    }

    struct NodeInfo {
        bytes nodeId;
        uint72 identityId;
        uint96 ask;
        uint96 stake;
    }

    error NodeAlreadyInTheShardingTable(uint72 identityId);
    error InvalidIndexWithRespectToPreviousNode(
        uint72 identityId,
        uint256 hashRingPosition,
        uint256 prevHashRingPosition
    );
    error InvalidIndexWithRespectToNextNode(uint72 identityId, uint256 hashRingPosition, uint256 nextHashRingPosition);
    error InvalidStartingIdentityId(uint72 identityId);
    error ShardingTableIsFull();
}
