// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {Guardian} from "../Guardian.sol";
import {KnowledgeAssetsLib} from "../libraries/KnowledgeAssetsLib.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";

/**
 * @title KnowledgeAssetsStorage
 * @notice V9 storage contract for Knowledge Assets with address-based publisher namespaces.
 *
 * UAL format: did:dkg:{chainId}/{publisherAddress}/{localKAId}
 *
 * Any address can reserve ID ranges and batch-mint KAs — no on-chain identity required.
 * This replaces V8's KnowledgeCollectionStorage for new V9 publishes.
 * The legacy KnowledgeCollectionStorage remains read-only for V8 data.
 */
contract KnowledgeAssetsStorage is INamed, IVersioned, Guardian {
    event UALRangeReserved(
        address indexed publisher,
        uint64 startId,
        uint64 endId
    );

    event KnowledgeBatchCreated(
        uint256 indexed batchId,
        address indexed publisher,
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

    event NamespaceTransferred(
        address indexed from,
        address indexed to
    );

    string private constant _NAME = "KnowledgeAssetsStorage";
    string private constant _VERSION = "2.0.0";

    // --- Publisher Namespace State (keyed by address) ---

    mapping(address => KnowledgeAssetsLib.PublisherRange[]) public publisherRanges;
    mapping(address => uint64) public publisherNextId;

    // --- Knowledge Batch State ---

    uint256 private _batchCounter;
    mapping(uint256 => KnowledgeAssetsLib.KnowledgeBatch) public knowledgeBatches;

    // publisher address => localKAId => batchId (0 = unused)
    mapping(address => mapping(uint64 => uint256)) public kaIdToBatch;

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

    function reserveUALRange(
        address publisher,
        uint32 count
    ) external onlyContracts returns (uint64 startId, uint64 endId) {
        uint64 nextId = publisherNextId[publisher];
        if (nextId == 0) {
            nextId = 1;
        }

        startId = nextId;
        endId = nextId + uint64(count) - 1;

        publisherRanges[publisher].push(
            KnowledgeAssetsLib.PublisherRange(startId, endId)
        );
        publisherNextId[publisher] = endId + 1;

        emit UALRangeReserved(publisher, startId, endId);
    }

    function isIdInReservedRange(
        address publisher,
        uint64 kaId
    ) external view returns (bool) {
        KnowledgeAssetsLib.PublisherRange[] storage ranges = publisherRanges[publisher];
        for (uint256 i; i < ranges.length; i++) {
            if (kaId >= ranges[i].startId && kaId <= ranges[i].endId) {
                return true;
            }
        }
        return false;
    }

    function getPublisherRangesCount(address publisher) external view returns (uint256) {
        return publisherRanges[publisher].length;
    }

    function getPublisherRange(
        address publisher,
        uint256 index
    ) external view returns (uint64 startId, uint64 endId) {
        KnowledgeAssetsLib.PublisherRange storage r = publisherRanges[publisher][index];
        return (r.startId, r.endId);
    }

    // --- Knowledge Batch CRUD ---

    function createKnowledgeBatch(
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

        for (uint64 id = startKAId; id <= endKAId; id++) {
            kaIdToBatch[publisherAddress][id] = batchId;
        }

        unchecked {
            _totalTokenAmount += tokenAmount;
            _totalKnowledgeAssets += knowledgeAssetsCount;
        }

        emit KnowledgeBatchCreated(
            batchId,
            publisherAddress,
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

    // --- Namespace Transfer ---

    /**
     * @notice Transfer an entire publisher namespace (ranges, nextId, batch ownership)
     * from one address to another. Only callable by Hub-registered contracts.
     */
    function transferNamespace(address from, address to) external onlyContracts {
        if (publisherNextId[to] != 0 || publisherRanges[to].length != 0) {
            revert KnowledgeAssetsLib.NamespaceAlreadyExists(to);
        }

        // Transfer reserved ranges
        KnowledgeAssetsLib.PublisherRange[] storage fromRanges = publisherRanges[from];
        for (uint256 i; i < fromRanges.length; i++) {
            publisherRanges[to].push(fromRanges[i]);
        }
        delete publisherRanges[from];

        // Transfer nextId counter
        publisherNextId[to] = publisherNextId[from];
        delete publisherNextId[from];

        // Transfer kaIdToBatch mappings — iterate over all ranges and remap
        KnowledgeAssetsLib.PublisherRange[] storage toRanges = publisherRanges[to];
        for (uint256 i; i < toRanges.length; i++) {
            for (uint64 id = toRanges[i].startId; id <= toRanges[i].endId; id++) {
                uint256 bid = kaIdToBatch[from][id];
                if (bid != 0) {
                    kaIdToBatch[to][id] = bid;
                    delete kaIdToBatch[from][id];

                    // Update batch publisher address
                    knowledgeBatches[bid].publisherAddress = to;
                }
            }
        }

        emit NamespaceTransferred(from, to);
    }

    // --- Getters ---

    function getBatch(uint256 batchId) external view returns (KnowledgeAssetsLib.KnowledgeBatch memory) {
        return knowledgeBatches[batchId];
    }

    function getBatchMerkleRoot(uint256 batchId) external view returns (bytes32) {
        return knowledgeBatches[batchId].merkleRoot;
    }

    function getBatchPublisher(uint256 batchId) external view returns (address) {
        return knowledgeBatches[batchId].publisherAddress;
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

    function isKAIdUsed(address publisher, uint64 kaId) external view returns (bool) {
        return kaIdToBatch[publisher][kaId] != 0;
    }

    function getBatchForKAId(address publisher, uint64 kaId) external view returns (uint256) {
        return kaIdToBatch[publisher][kaId];
    }
}
