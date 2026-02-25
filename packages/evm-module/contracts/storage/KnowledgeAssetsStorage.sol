// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {Guardian} from "../Guardian.sol";
import {KnowledgeAssetsLib} from "../libraries/KnowledgeAssetsLib.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";

/**
 * @title KnowledgeAssetsStorage
 * @notice V9 storage contract for Knowledge Assets with publisher-namespaced UALs.
 *
 * UAL format: did:dkg:{chainId}/{publisherIdentityId}/{localKAId}
 *
 * Publishers reserve ID ranges, then batch-mint KAs from those ranges.
 * This replaces V8's KnowledgeCollectionStorage for new V9 publishes.
 * The legacy KnowledgeCollectionStorage remains read-only for V8 data.
 */
contract KnowledgeAssetsStorage is INamed, IVersioned, Guardian {
    event UALRangeReserved(
        uint72 indexed publisherIdentityId,
        uint64 startId,
        uint64 endId
    );

    event KnowledgeBatchCreated(
        uint256 indexed batchId,
        uint72 indexed publisherIdentityId,
        bytes32 merkleRoot,
        uint64 publicByteSize,
        uint32 knowledgeAssetsCount,
        uint64 startKAId,
        uint64 endKAId,
        uint40 startEpoch,
        uint40 endEpoch,
        uint96 tokenAmount,
        bool isPermanent
    );

    event KnowledgeBatchUpdated(
        uint256 indexed batchId,
        bytes32 newMerkleRoot,
        uint64 newPublicByteSize,
        uint96 updateCost
    );

    event StorageExtended(
        uint256 indexed batchId,
        uint40 additionalEpochs,
        uint40 newEndEpoch,
        uint96 additionalTokens
    );

    string private constant _NAME = "KnowledgeAssetsStorage";
    string private constant _VERSION = "1.0.0";

    // --- Publisher Namespace State ---

    // publisherIdentityId => reserved ranges (append-only)
    mapping(uint72 => KnowledgeAssetsLib.PublisherRange[]) public publisherRanges;

    // publisherIdentityId => next available local KA ID
    mapping(uint72 => uint64) public publisherNextId;

    // --- Knowledge Batch State ---

    uint256 private _batchCounter;

    // batchId => batch metadata
    mapping(uint256 => KnowledgeAssetsLib.KnowledgeBatch) public knowledgeBatches;

    // publisherIdentityId => localKAId => batchId (0 = unused)
    mapping(uint72 => mapping(uint64 => uint256)) public kaIdToBatch;

    // --- Aggregate Counters ---

    uint96 private _totalTokenAmount;
    uint256 private _totalKnowledgeAssets;

    constructor(address hubAddress) Guardian(hubAddress) {}

    function name() public pure virtual returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual returns (string memory) {
        return _VERSION;
    }

    // --- Publisher Namespace ---

    /**
     * @notice Reserve a block of KA IDs for a publisher. Gas cost only, no TRAC fee.
     * @param publisherIdentityId The on-chain identity of the publisher
     * @param count How many IDs to reserve
     * @return startId First ID in the reserved range
     * @return endId Last ID in the reserved range (inclusive)
     */
    function reserveUALRange(
        uint72 publisherIdentityId,
        uint32 count
    ) external onlyContracts returns (uint64 startId, uint64 endId) {
        uint64 nextId = publisherNextId[publisherIdentityId];
        if (nextId == 0) {
            nextId = 1; // IDs start at 1
        }

        startId = nextId;
        endId = nextId + uint64(count) - 1;

        publisherRanges[publisherIdentityId].push(
            KnowledgeAssetsLib.PublisherRange(startId, endId)
        );
        publisherNextId[publisherIdentityId] = endId + 1;

        emit UALRangeReserved(publisherIdentityId, startId, endId);
    }

    /**
     * @notice Check if a KA ID is within any reserved range for a publisher.
     */
    function isIdInReservedRange(
        uint72 publisherIdentityId,
        uint64 kaId
    ) external view returns (bool) {
        KnowledgeAssetsLib.PublisherRange[] storage ranges = publisherRanges[publisherIdentityId];
        for (uint256 i; i < ranges.length; i++) {
            if (kaId >= ranges[i].startId && kaId <= ranges[i].endId) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Get the number of reserved ranges for a publisher.
     */
    function getPublisherRangesCount(uint72 publisherIdentityId) external view returns (uint256) {
        return publisherRanges[publisherIdentityId].length;
    }

    /**
     * @notice Get a specific reserved range by index.
     */
    function getPublisherRange(
        uint72 publisherIdentityId,
        uint256 index
    ) external view returns (uint64 startId, uint64 endId) {
        KnowledgeAssetsLib.PublisherRange storage r = publisherRanges[publisherIdentityId][index];
        return (r.startId, r.endId);
    }

    // --- Knowledge Batch CRUD ---

    /**
     * @notice Create a new knowledge batch (called by the KnowledgeAssets logic contract).
     * @return batchId The ID of the newly created batch
     */
    function createKnowledgeBatch(
        uint72 publisherIdentityId,
        address publisherAddress,
        bytes32 merkleRoot,
        uint64 publicByteSize,
        uint32 knowledgeAssetsCount,
        uint64 startKAId,
        uint64 endKAId,
        uint40 startEpoch,
        uint40 endEpoch,
        uint96 tokenAmount,
        bool isPermanent
    ) external onlyContracts returns (uint256 batchId) {
        batchId = ++_batchCounter;

        knowledgeBatches[batchId] = KnowledgeAssetsLib.KnowledgeBatch({
            publisherIdentityId: publisherIdentityId,
            publisherAddress: publisherAddress,
            merkleRoot: merkleRoot,
            publicByteSize: publicByteSize,
            knowledgeAssetsCount: knowledgeAssetsCount,
            startKAId: startKAId,
            endKAId: endKAId,
            startEpoch: startEpoch,
            endEpoch: endEpoch,
            tokenAmount: tokenAmount,
            isPermanent: isPermanent,
            createdAt: block.timestamp
        });

        // Mark all KA IDs in the batch as used
        for (uint64 id = startKAId; id <= endKAId; id++) {
            kaIdToBatch[publisherIdentityId][id] = batchId;
        }

        unchecked {
            _totalTokenAmount += tokenAmount;
            _totalKnowledgeAssets += knowledgeAssetsCount;
        }

        emit KnowledgeBatchCreated(
            batchId,
            publisherIdentityId,
            merkleRoot,
            publicByteSize,
            knowledgeAssetsCount,
            startKAId,
            endKAId,
            startEpoch,
            endEpoch,
            tokenAmount,
            isPermanent
        );
    }

    /**
     * @notice Update the merkle root and byte size of an existing batch.
     */
    function updateKnowledgeBatch(
        uint256 batchId,
        bytes32 newMerkleRoot,
        uint64 newPublicByteSize,
        uint96 updateCost
    ) external onlyContracts {
        KnowledgeAssetsLib.KnowledgeBatch storage batch = knowledgeBatches[batchId];

        batch.merkleRoot = newMerkleRoot;
        batch.publicByteSize = newPublicByteSize;

        unchecked {
            _totalTokenAmount += updateCost;
            batch.tokenAmount += updateCost;
        }

        emit KnowledgeBatchUpdated(batchId, newMerkleRoot, newPublicByteSize, updateCost);
    }

    /**
     * @notice Extend the storage duration of a batch.
     */
    function extendBatchStorage(
        uint256 batchId,
        uint40 additionalEpochs,
        uint96 additionalTokens
    ) external onlyContracts {
        KnowledgeAssetsLib.KnowledgeBatch storage batch = knowledgeBatches[batchId];

        batch.endEpoch += additionalEpochs;

        unchecked {
            _totalTokenAmount += additionalTokens;
            batch.tokenAmount += additionalTokens;
        }

        emit StorageExtended(batchId, additionalEpochs, batch.endEpoch, additionalTokens);
    }

    // --- Getters ---

    function getBatch(uint256 batchId) external view returns (KnowledgeAssetsLib.KnowledgeBatch memory) {
        return knowledgeBatches[batchId];
    }

    function getBatchMerkleRoot(uint256 batchId) external view returns (bytes32) {
        return knowledgeBatches[batchId].merkleRoot;
    }

    function getBatchPublisher(uint256 batchId) external view returns (uint72, address) {
        KnowledgeAssetsLib.KnowledgeBatch storage b = knowledgeBatches[batchId];
        return (b.publisherIdentityId, b.publisherAddress);
    }

    function getBatchEpochs(uint256 batchId) external view returns (uint40 startEpoch, uint40 endEpoch) {
        KnowledgeAssetsLib.KnowledgeBatch storage b = knowledgeBatches[batchId];
        return (b.startEpoch, b.endEpoch);
    }

    function getLatestBatchId() external view returns (uint256) {
        return _batchCounter;
    }

    function getTotalTokenAmount() external view returns (uint96) {
        return _totalTokenAmount;
    }

    function getTotalKnowledgeAssets() external view returns (uint256) {
        return _totalKnowledgeAssets;
    }

    function isKAIdUsed(uint72 publisherIdentityId, uint64 kaId) external view returns (bool) {
        return kaIdToBatch[publisherIdentityId][kaId] != 0;
    }

    function getBatchForKAId(uint72 publisherIdentityId, uint64 kaId) external view returns (uint256) {
        return kaIdToBatch[publisherIdentityId][kaId];
    }
}
