// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {INamed} from "../../interfaces/INamed.sol";
import {IVersioned} from "../../interfaces/IVersioned.sol";
import {HubDependent} from "../../abstract/HubDependent.sol";
import {ParanetLib} from "../../libraries/ParanetLib.sol";

contract ParanetStagingRegistry is INamed, IVersioned, HubDependent {
    string private constant _NAME = "ParanetStagingRegistry";
    string private constant _VERSION = "1.0.0";

    // Events
    event KnowledgeCollectionStaged(
        bytes32 indexed paranetId,
        bytes32 indexed knowledgeCollectionId,
        address indexed submitter
    );
    event KnowledgeCollectionReviewed(bytes32 indexed paranetId, bytes32 indexed knowledgeCollectionId, bool accepted);
    event CuratorAdded(bytes32 indexed paranetId, address indexed curator);
    event CuratorRemoved(bytes32 indexed paranetId, address indexed curator);

    struct StagedCollection {
        bytes32 knowledgeCollectionId;
        address submitter;
        ParanetLib.RequestStatus status;
    }

    // Paranet ID => Collection ID => Staging Status
    mapping(bytes32 => mapping(bytes32 => ParanetLib.RequestStatus)) public stagedCollections;

    // Paranet ID => Collection ID => Submitter Address
    mapping(bytes32 => mapping(bytes32 => address)) public collectionSubmitters;

    // Paranet ID => Curator Address => Is Curator
    mapping(bytes32 => mapping(address => bool)) public curators;

    // Paranet ID => Curator => Index
    mapping(bytes32 => mapping(address => uint256)) public paranetCuratorIndexes;
    // Paranet ID => Curators
    mapping(bytes32 => address[]) public paranetCurators;

    // Track collections for pagination
    mapping(bytes32 => bytes32[]) private pendingknowledgeCollectionIds;
    // Paranet ID => Collection ID => Index
    mapping(bytes32 => mapping(bytes32 => uint256)) private pendingCollectionIndexes;

    constructor(address hubAddress) HubDependent(hubAddress) {}

    function name() external pure override returns (string memory) {
        return _NAME;
    }

    function version() external pure override returns (string memory) {
        return _VERSION;
    }

    function addCurator(bytes32 paranetId, address curator) public onlyContracts {
        paranetCuratorIndexes[paranetId][curator] = paranetCurators[paranetId].length;
        paranetCurators[paranetId].push(curator);

        curators[paranetId][curator] = true;

        emit CuratorAdded(paranetId, curator);
    }

    function removeCurator(bytes32 paranetId, address curator) public onlyContracts {
        uint256 index = paranetCuratorIndexes[paranetId][curator];
        uint256 lastIndex = paranetCurators[paranetId].length - 1;

        if (index != lastIndex) {
            address lastCurator = paranetCurators[paranetId][lastIndex];
            paranetCurators[paranetId][index] = lastCurator;
            paranetCuratorIndexes[paranetId][lastCurator] = index;
        }

        paranetCurators[paranetId].pop();
        delete paranetCuratorIndexes[paranetId][curator];
        delete curators[paranetId][curator];

        emit CuratorRemoved(paranetId, curator);
    }

    function getAllParanetCurators(bytes32 paranetId) public view returns (address[] memory) {
        return paranetCurators[paranetId];
    }

    function isCurator(bytes32 paranetId, address account) external view returns (bool) {
        return curators[paranetId][account];
    }

    function stageKnowledgeCollection(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId,
        address submitter
    ) external onlyContracts {
        stagedCollections[paranetId][knowledgeCollectionId] = ParanetLib.RequestStatus.PENDING;
        collectionSubmitters[paranetId][knowledgeCollectionId] = submitter;
        emit KnowledgeCollectionStaged(paranetId, knowledgeCollectionId, submitter);
        _addToPendingCollections(paranetId, knowledgeCollectionId);
    }

    function reviewKnowledgeCollection(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId,
        bool accepted
    ) external onlyContracts {
        stagedCollections[paranetId][knowledgeCollectionId] = accepted
            ? ParanetLib.RequestStatus.APPROVED
            : ParanetLib.RequestStatus.REJECTED;

        emit KnowledgeCollectionReviewed(paranetId, knowledgeCollectionId, accepted);
        _removeFromPendingCollections(paranetId, knowledgeCollectionId);
    }

    function isKnowledgeCollectionStaged(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId
    ) external view returns (bool) {
        return stagedCollections[paranetId][knowledgeCollectionId] == ParanetLib.RequestStatus.PENDING;
    }

    function isKnowledgeCollectionApproved(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId
    ) external view returns (bool) {
        return stagedCollections[paranetId][knowledgeCollectionId] == ParanetLib.RequestStatus.APPROVED;
    }

    function getKnowledgeCollectionStatus(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId
    ) external view returns (ParanetLib.RequestStatus) {
        return stagedCollections[paranetId][knowledgeCollectionId];
    }

    function getKnowledgeCollectionSubmitter(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId
    ) external view returns (address) {
        return collectionSubmitters[paranetId][knowledgeCollectionId];
    }

    function _addToPendingCollections(bytes32 paranetId, bytes32 knowledgeCollectionId) internal {
        pendingCollectionIndexes[paranetId][knowledgeCollectionId] = pendingknowledgeCollectionIds[paranetId].length;
        pendingknowledgeCollectionIds[paranetId].push(knowledgeCollectionId);
    }

    function _removeFromPendingCollections(bytes32 paranetId, bytes32 knowledgeCollectionId) internal {
        uint256 index = pendingCollectionIndexes[paranetId][knowledgeCollectionId];
        uint256 lastIndex = pendingknowledgeCollectionIds[paranetId].length - 1;

        if (index != lastIndex) {
            bytes32 lastknowledgeCollectionId = pendingknowledgeCollectionIds[paranetId][lastIndex];
            pendingknowledgeCollectionIds[paranetId][index] = lastknowledgeCollectionId;
            pendingCollectionIndexes[paranetId][lastknowledgeCollectionId] = index;
        }

        pendingknowledgeCollectionIds[paranetId].pop();
        delete pendingCollectionIndexes[paranetId][knowledgeCollectionId];
    }

    function getPendingCollections(
        bytes32 paranetId,
        uint256 offset,
        uint256 limit
    ) external view returns (StagedCollection[] memory collections, uint256 total) {
        total = pendingknowledgeCollectionIds[paranetId].length;

        if (offset >= total || limit == 0) {
            return (new StagedCollection[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLength = end - offset;

        collections = new StagedCollection[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            bytes32 knowledgeCollectionId = pendingknowledgeCollectionIds[paranetId][offset + i];
            collections[i] = StagedCollection({
                knowledgeCollectionId: knowledgeCollectionId,
                submitter: collectionSubmitters[paranetId][knowledgeCollectionId],
                status: stagedCollections[paranetId][knowledgeCollectionId]
            });
        }
    }
}
