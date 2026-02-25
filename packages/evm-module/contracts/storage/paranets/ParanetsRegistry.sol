// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {HubDependent} from "../../abstract/HubDependent.sol";
import {INamed} from "../../interfaces/INamed.sol";
import {IVersioned} from "../../interfaces/IVersioned.sol";
import {ParanetLib} from "../../libraries/ParanetLib.sol";

contract ParanetsRegistry is INamed, IVersioned, HubDependent {
    string private constant _NAME = "ParanetsRegistry";
    string private constant _VERSION = "1.0.1";

    uint256 private constant _MAX_INCENTIVES_POOLS = 50;

    bytes32[] private paranetIds;

    mapping(bytes32 => uint256) internal paranetIdsMapping;
    // Paranet ID => Paranet Object
    mapping(bytes32 => ParanetLib.Paranet) internal paranets;

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) HubDependent(hubAddress) {}

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function registerParanet(
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId,
        uint256 knowledgeAssetTokenId,
        string calldata paranetName,
        string calldata paranetDescription,
        uint8 nodesAccessPolicy,
        uint8 minersAccessPolicy,
        uint8 knowledgeCollectionsSubmissionPolicy
    ) external onlyContracts returns (bytes32) {
        bytes32 paranetId = keccak256(
            abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId, knowledgeAssetTokenId)
        );

        ParanetLib.Paranet storage paranet = paranets[paranetId];

        paranet.paranetKCStorageContract = knowledgeCollectionStorageContract;
        paranet.paranetKCTokenId = knowledgeCollectionTokenId;
        paranet.paranetKATokenId = knowledgeAssetTokenId;
        paranet.name = paranetName;
        paranet.description = paranetDescription;
        paranet.nodesAccessPolicy = nodesAccessPolicy;
        paranet.minersAccessPolicy = minersAccessPolicy;
        paranet.knowledgeCollectionsSubmissionPolicy = knowledgeCollectionsSubmissionPolicy;

        paranetIds.push(paranetId);
        paranetIdsMapping[paranetId] = paranetIds.length - 1;

        return paranetId;
    }

    function deleteParanet(bytes32 paranetId) external onlyContracts {
        delete paranets[paranetId];
        uint256 indexToRemove = paranetIdsMapping[paranetId];
        uint256 lastIndex = paranetIds.length - 1;
        if (indexToRemove != lastIndex) {
            bytes32 lastParanetId = paranetIds[lastIndex];

            paranetIds[indexToRemove] = lastParanetId;
            paranetIdsMapping[lastParanetId] = indexToRemove;
        }

        paranetIds.pop();
        delete paranetIdsMapping[paranetId];
    }

    function paranetExists(bytes32 paranetId) external view returns (bool) {
        return
            keccak256(
                abi.encodePacked(
                    paranets[paranetId].paranetKCStorageContract,
                    paranets[paranetId].paranetKCTokenId,
                    paranets[paranetId].paranetKATokenId
                )
            ) == paranetId;
    }

    function getParanetMetadata(bytes32 paranetId) external view returns (ParanetLib.ParanetMetadata memory) {
        ParanetLib.Paranet storage paranet = paranets[paranetId];
        return
            ParanetLib.ParanetMetadata({
                paranetKCStorageContract: paranet.paranetKCStorageContract,
                paranetKCTokenId: paranet.paranetKCTokenId,
                paranetKATokenId: paranet.paranetKATokenId,
                name: paranet.name,
                description: paranet.description,
                nodesAccessPolicy: paranet.nodesAccessPolicy,
                minersAccessPolicy: paranet.minersAccessPolicy,
                knowledgeCollectionsSubmissionPolicy: paranet.knowledgeCollectionsSubmissionPolicy,
                cumulativeKnowledgeValue: paranet.cumulativeKnowledgeValue
            });
    }

    function getParanetKnowledgeAssetLocator(bytes32 paranetId) external view returns (address, uint256, uint256) {
        return (
            paranets[paranetId].paranetKCStorageContract,
            paranets[paranetId].paranetKCTokenId,
            paranets[paranetId].paranetKATokenId
        );
    }

    function getName(bytes32 paranetId) external view returns (string memory) {
        return paranets[paranetId].name;
    }

    function setName(bytes32 paranetId, string calldata name_) external onlyContracts {
        paranets[paranetId].name = name_;
    }

    function getDescription(bytes32 paranetId) external view returns (string memory) {
        return paranets[paranetId].description;
    }

    function setDescription(bytes32 paranetId, string calldata description) external onlyContracts {
        paranets[paranetId].description = description;
    }

    function getNodesAccessPolicy(bytes32 paranetId) external view returns (uint8) {
        return paranets[paranetId].nodesAccessPolicy;
    }

    function setNodesAccessPolicy(bytes32 paranetId, uint8 nodesAccessPolicy) external onlyContracts {
        paranets[paranetId].nodesAccessPolicy = nodesAccessPolicy;
    }

    function getMinersAccessPolicy(bytes32 paranetId) external view returns (uint8) {
        return paranets[paranetId].minersAccessPolicy;
    }

    function setMinersAccessPolicy(bytes32 paranetId, uint8 minersAccessPolicy) external onlyContracts {
        paranets[paranetId].minersAccessPolicy = minersAccessPolicy;
    }

    function getKnowledgeCollectionsSubmissionPolicy(bytes32 paranetId) external view returns (uint8) {
        return paranets[paranetId].knowledgeCollectionsSubmissionPolicy;
    }

    function setKnowledgeCollectionsSubmissionPolicy(
        bytes32 paranetId,
        uint8 knowledgeCollectionsSubmissionPolicy
    ) external onlyContracts {
        paranets[paranetId].knowledgeCollectionsSubmissionPolicy = knowledgeCollectionsSubmissionPolicy;
    }

    function addNodeJoinRequest(
        bytes32 paranetId,
        uint72 identityId,
        ParanetLib.RequestStatus status
    ) external onlyContracts {
        paranets[paranetId].paranetNodeJoinRequests[identityId].push(
            ParanetLib.ParanetNodeJoinRequest({
                createdAt: block.timestamp,
                updatedAt: block.timestamp,
                identityId: identityId,
                status: status
            })
        );
    }

    function updateNodeJoinRequestStatus(
        bytes32 paranetId,
        uint72 identityId,
        uint256 index,
        ParanetLib.RequestStatus status
    ) external onlyContracts {
        paranets[paranetId].paranetNodeJoinRequests[identityId][index].status = status;
        paranets[paranetId].paranetNodeJoinRequests[identityId][index].updatedAt = block.timestamp;
    }

    function removeNodeJoinRequest(bytes32 paranetId, uint72 identityId, uint256 index) external onlyContracts {
        delete paranets[paranetId].paranetNodeJoinRequests[identityId][index];
    }

    function getNodeJoinRequest(
        bytes32 paranetId,
        uint72 identityId,
        uint256 index
    ) external view returns (ParanetLib.ParanetNodeJoinRequest memory) {
        return paranets[paranetId].paranetNodeJoinRequests[identityId][index];
    }

    function getLatestNodeJoinRequest(
        bytes32 paranetId,
        uint72 identityId
    ) external view returns (ParanetLib.ParanetNodeJoinRequest memory) {
        return
            paranets[paranetId].paranetNodeJoinRequests[identityId][
                paranets[paranetId].paranetNodeJoinRequests[identityId].length - 1
            ];
    }

    function getNodeJoinRequests(
        bytes32 paranetId,
        uint72 identityId
    ) external view returns (ParanetLib.ParanetNodeJoinRequest[] memory) {
        return paranets[paranetId].paranetNodeJoinRequests[identityId];
    }

    function getNodeJoinRequestsCount(bytes32 paranetId, uint72 identityId) external view returns (uint256) {
        return paranets[paranetId].paranetNodeJoinRequests[identityId].length;
    }

    function addPermissionedNode(bytes32 paranetId, uint72 identityId, bytes calldata nodeId) external onlyContracts {
        paranets[paranetId].permissionedNodesIndexes[identityId] = paranets[paranetId].permissionedNodes.length;
        paranets[paranetId].permissionedNodes.push(ParanetLib.Node({identityId: identityId, nodeId: nodeId}));
    }

    function removePermissionedNode(bytes32 paranetId, uint72 identityId) external onlyContracts {
        paranets[paranetId].permissionedNodes[paranets[paranetId].permissionedNodesIndexes[identityId]] = paranets[
            paranetId
        ].permissionedNodes[paranets[paranetId].permissionedNodes.length - 1];
        paranets[paranetId].permissionedNodesIndexes[
            paranets[paranetId].permissionedNodes[paranets[paranetId].permissionedNodes.length - 1].identityId
        ] = paranets[paranetId].permissionedNodesIndexes[identityId];

        delete paranets[paranetId].permissionedNodesIndexes[identityId];
        paranets[paranetId].permissionedNodes.pop();
    }

    function getPermissionedNodes(bytes32 paranetId) external view returns (ParanetLib.Node[] memory) {
        return paranets[paranetId].permissionedNodes;
    }

    function getPermissionedNodesCount(bytes32 paranetId) external view returns (uint256) {
        return paranets[paranetId].permissionedNodes.length;
    }

    function isPermissionedNode(bytes32 paranetId, uint72 identityId) external view returns (bool) {
        return (paranets[paranetId].permissionedNodes.length != 0 &&
            paranets[paranetId]
                .permissionedNodes[paranets[paranetId].permissionedNodesIndexes[identityId]]
                .identityId ==
            identityId);
    }

    function addIncentivesPool(
        bytes32 paranetId,
        string calldata incentivesPoolName,
        address storageAddress,
        address rewardTokenAddress
    ) external onlyContracts {
        require(paranets[paranetId].incentivesPools.length < _MAX_INCENTIVES_POOLS, "Max incentives pools reached");
        ParanetLib.IncentivesPool memory incentivesPool = ParanetLib.IncentivesPool({
            name: incentivesPoolName,
            storageAddr: storageAddress,
            rewardTokenAddress: rewardTokenAddress
        });
        paranets[paranetId].incentivesPoolsByNameIndexes[incentivesPoolName] = paranets[paranetId]
            .incentivesPools
            .length;
        paranets[paranetId].incentivesPoolsByStorageAddressIndexes[storageAddress] = paranets[paranetId]
            .incentivesPools
            .length;
        paranets[paranetId].incentivesPools.push(incentivesPool);
    }

    function getIncentivesPoolByPoolName(
        bytes32 paranetId,
        string calldata poolName
    ) external view returns (ParanetLib.IncentivesPool memory) {
        return paranets[paranetId].incentivesPools[paranets[paranetId].incentivesPoolsByNameIndexes[poolName]];
    }

    function getIncentivesPoolByStorageAddress(
        bytes32 paranetId,
        address storageAddr
    ) external view returns (ParanetLib.IncentivesPool memory) {
        return
            paranets[paranetId].incentivesPools[
                paranets[paranetId].incentivesPoolsByStorageAddressIndexes[storageAddr]
            ];
    }

    function getAllIncentivesPools(bytes32 paranetId) external view returns (ParanetLib.IncentivesPool[] memory) {
        return paranets[paranetId].incentivesPools;
    }

    function hasIncentivesPoolByName(bytes32 paranetId, string calldata poolName) external view returns (bool) {
        ParanetLib.Paranet storage paranet = paranets[paranetId];

        if (paranet.incentivesPools.length == 0) {
            return false;
        }

        uint256 index = paranet.incentivesPoolsByNameIndexes[poolName];

        if (index >= paranet.incentivesPools.length) {
            return false;
        }

        return
            keccak256(abi.encodePacked(paranet.incentivesPools[index].name)) == keccak256(abi.encodePacked(poolName));
    }

    function hasIncentivesPoolByStorageAddress(bytes32 paranetId, address storageAddr) external view returns (bool) {
        ParanetLib.Paranet storage paranet = paranets[paranetId];

        if (paranet.incentivesPools.length == 0) {
            return false;
        }

        uint256 index = paranet.incentivesPoolsByStorageAddressIndexes[storageAddr];

        if (index >= paranet.incentivesPools.length) {
            return false;
        }

        address incentivesPoolStorageAddress = paranet.incentivesPools[index].storageAddr;

        return incentivesPoolStorageAddress != address(0) && incentivesPoolStorageAddress == storageAddr;
    }

    function getCumulativeKnowledgeValue(bytes32 paranetId) external view returns (uint96) {
        return paranets[paranetId].cumulativeKnowledgeValue;
    }

    function setCumulativeKnowledgeValue(bytes32 paranetId, uint96 cumulativeKnowledgeValue) external onlyContracts {
        paranets[paranetId].cumulativeKnowledgeValue = cumulativeKnowledgeValue;
    }

    function addCumulativeKnowledgeValue(bytes32 paranetId, uint96 addedKnowledgeValue) external onlyContracts {
        paranets[paranetId].cumulativeKnowledgeValue += addedKnowledgeValue;
    }

    function subCumulativeKnowledgeValue(bytes32 paranetId, uint96 subtractedKnowledgeValue) external onlyContracts {
        paranets[paranetId].cumulativeKnowledgeValue -= subtractedKnowledgeValue;
    }

    function addService(bytes32 paranetId, bytes32 serviceId) external onlyContracts {
        paranets[paranetId].implementedServicesIndexes[serviceId] = paranets[paranetId].services.length;
        paranets[paranetId].services.push(serviceId);
    }

    function removeService(bytes32 paranetId, bytes32 serviceId) external onlyContracts {
        paranets[paranetId].services[paranets[paranetId].implementedServicesIndexes[serviceId]] = paranets[paranetId]
            .services[paranets[paranetId].services.length - 1];
        paranets[paranetId].implementedServicesIndexes[
            paranets[paranetId].services[paranets[paranetId].services.length - 1]
        ] = paranets[paranetId].implementedServicesIndexes[serviceId];

        delete paranets[paranetId].implementedServicesIndexes[serviceId];
        paranets[paranetId].services.pop();
    }

    function getServices(bytes32 paranetId) external view returns (bytes32[] memory) {
        return paranets[paranetId].services;
    }

    function getServicesCount(bytes32 paranetId) external view returns (uint256) {
        return paranets[paranetId].services.length;
    }

    function isServiceImplemented(bytes32 paranetId, bytes32 serviceId) external view returns (bool) {
        return (paranets[paranetId].services.length != 0 &&
            paranets[paranetId].services[paranets[paranetId].implementedServicesIndexes[serviceId]] == serviceId);
    }

    function addKnowledgeMiner(bytes32 paranetId, address knowledgeMinerAddress) external onlyContracts {
        paranets[paranetId].registeredKnowledgeMinersIndexes[knowledgeMinerAddress] = paranets[paranetId]
            .knowledgeMiners
            .length;
        paranets[paranetId].knowledgeMiners.push(knowledgeMinerAddress);
    }

    function removeKnowledgeMiner(bytes32 paranetId, address knowledgeMinerAddress) external onlyContracts {
        paranets[paranetId].knowledgeMiners[
            paranets[paranetId].registeredKnowledgeMinersIndexes[knowledgeMinerAddress]
        ] = paranets[paranetId].knowledgeMiners[paranets[paranetId].knowledgeMiners.length - 1];
        paranets[paranetId].registeredKnowledgeMinersIndexes[
            paranets[paranetId].knowledgeMiners[paranets[paranetId].knowledgeMiners.length - 1]
        ] = paranets[paranetId].registeredKnowledgeMinersIndexes[knowledgeMinerAddress];

        delete paranets[paranetId].registeredKnowledgeMinersIndexes[knowledgeMinerAddress];
        paranets[paranetId].knowledgeMiners.pop();
    }

    function getKnowledgeMiners(bytes32 paranetId) external view returns (address[] memory) {
        return paranets[paranetId].knowledgeMiners;
    }

    function getKnowledgeMinersCount(bytes32 paranetId) external view returns (uint256) {
        return paranets[paranetId].knowledgeMiners.length;
    }

    function isKnowledgeMinerRegistered(bytes32 paranetId, address knowledgeMinerAddress) external view returns (bool) {
        return (paranets[paranetId].knowledgeMiners.length != 0 &&
            paranets[paranetId].knowledgeMiners[
                paranets[paranetId].registeredKnowledgeMinersIndexes[knowledgeMinerAddress]
            ] ==
            knowledgeMinerAddress);
    }

    function addKnowledgeMinerAccessRequest(
        bytes32 paranetId,
        address miner,
        ParanetLib.RequestStatus status
    ) external onlyContracts {
        paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner].push(
            ParanetLib.ParanetKnowledgeMinerAccessRequest({
                createdAt: block.timestamp,
                updatedAt: block.timestamp,
                miner: miner,
                status: status
            })
        );
    }

    function updateKnowledgeMinerAccessRequestStatus(
        bytes32 paranetId,
        address miner,
        uint256 index,
        ParanetLib.RequestStatus status
    ) external onlyContracts {
        paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner][index].status = status;
        paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner][index].updatedAt = block.timestamp;
    }

    function removeKnowledgeMinerAccessRequest(bytes32 paranetId, address miner, uint256 index) external onlyContracts {
        delete paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner][index];
    }

    function getKnowledgeMinerAccessRequest(
        bytes32 paranetId,
        address miner,
        uint256 index
    ) external view returns (ParanetLib.ParanetKnowledgeMinerAccessRequest memory) {
        return paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner][index];
    }

    function getLatestKnowledgeMinerAccessRequest(
        bytes32 paranetId,
        address miner
    ) external view returns (ParanetLib.ParanetKnowledgeMinerAccessRequest memory) {
        return
            paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner][
                paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner].length - 1
            ];
    }

    function getKnowledgeMinerAccessRequests(
        bytes32 paranetId,
        address miner
    ) external view returns (ParanetLib.ParanetKnowledgeMinerAccessRequest[] memory) {
        return paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner];
    }

    function getKnowledgeMinerAccessRequestsCount(bytes32 paranetId, address miner) external view returns (uint256) {
        return paranets[paranetId].paranetKnowledgeMinerAccessRequests[miner].length;
    }

    function addKnowledgeCollecton(bytes32 paranetId, bytes32 knowledgeCollectionId) external onlyContracts {
        paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId] = paranets[paranetId]
            .knowledgeCollections
            .length;
        paranets[paranetId].knowledgeCollections.push(knowledgeCollectionId);
    }

    function removeKnowledgeCollection(bytes32 paranetId, bytes32 knowledgeCollectionId) external onlyContracts {
        paranets[paranetId].knowledgeCollections[
            paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId]
        ] = paranets[paranetId].knowledgeCollections[paranets[paranetId].knowledgeCollections.length - 1];
        paranets[paranetId].registeredKnowledgeCollectionsIndexes[
            paranets[paranetId].knowledgeCollections[paranets[paranetId].knowledgeCollections.length - 1]
        ] = paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId];

        delete paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId];
        paranets[paranetId].knowledgeCollections.pop();
    }

    function getKnowledgeCollections(bytes32 paranetId) external view returns (bytes32[] memory) {
        return paranets[paranetId].knowledgeCollections;
    }

    function getKnowledgeCollectionsWithPagination(
        bytes32 paranetId,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        if (offset >= paranets[paranetId].knowledgeCollections.length) {
            return new bytes32[](0);
        }

        uint256 fetchCount = (offset + limit > paranets[paranetId].knowledgeCollections.length)
            ? paranets[paranetId].knowledgeCollections.length - offset
            : limit;
        bytes32[] memory knowledgeCollections = new bytes32[](fetchCount);

        for (uint256 i = 0; i < fetchCount; i++) {
            knowledgeCollections[i] = paranets[paranetId].knowledgeCollections[offset + i];
        }

        return knowledgeCollections;
    }

    function getKnowledgeCollectionsStartingFromKnowlCollectionId(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        if (
            paranets[paranetId].knowledgeCollections[
                paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId]
            ] != knowledgeCollectionId
        ) {
            revert("Invalid starting KC");
        }

        if (
            paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId] >=
            paranets[paranetId].knowledgeCollections.length
        ) {
            return new bytes32[](0);
        }

        uint256 fetchCount = (paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId] + limit >
            paranets[paranetId].knowledgeCollections.length)
            ? paranets[paranetId].knowledgeCollections.length -
                paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId]
            : limit;
        bytes32[] memory knowledgeCollections = new bytes32[](fetchCount);

        for (uint256 i = 0; i < fetchCount; i++) {
            knowledgeCollections[i] = paranets[paranetId].knowledgeCollections[
                paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId] + i
            ];
        }

        return knowledgeCollections;
    }

    function getKnowledgeCollectionsCount(bytes32 paranetId) external view returns (uint256) {
        return paranets[paranetId].knowledgeCollections.length;
    }

    function isKnowledgeCollectionRegistered(
        bytes32 paranetId,
        bytes32 knowledgeCollectionId
    ) external view returns (bool) {
        return (paranets[paranetId].knowledgeCollections.length != 0 &&
            paranets[paranetId].knowledgeCollections[
                paranets[paranetId].registeredKnowledgeCollectionsIndexes[knowledgeCollectionId]
            ] ==
            knowledgeCollectionId);
    }

    function getParanetsCount() external view returns (uint256) {
        return paranetIds.length;
    }

    function getParanetIdAtIndex(uint256 index) external view returns (bytes32) {
        require(index < paranetIds.length, "Index out of range");
        return paranetIds[index];
    }

    function getAllParanetIds() external view returns (bytes32[] memory) {
        return paranetIds;
    }

    function getParanetIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        // If offset is past the end of the array, return an empty array
        if (offset >= paranetIds.length) {
            return new bytes32[](0);
        }

        uint256 end = offset + limit;
        if (end > paranetIds.length) {
            end = paranetIds.length;
        }

        bytes32[] memory ids = new bytes32[](end - offset);

        for (uint256 i = offset; i < end; i++) {
            ids[i - offset] = paranetIds[i];
        }

        return ids;
    }

    function getParanetIdsMapping(bytes32 paranetId) external view returns (uint256) {
        require(
            keccak256(
                abi.encodePacked(
                    paranets[paranetId].paranetKCStorageContract,
                    paranets[paranetId].paranetKCTokenId,
                    paranets[paranetId].paranetKATokenId
                )
            ) == paranetId,
            "Paranet not found"
        );

        return paranetIdsMapping[paranetId];
    }
}
