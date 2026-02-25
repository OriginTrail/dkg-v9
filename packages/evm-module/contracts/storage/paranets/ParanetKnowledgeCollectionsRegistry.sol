// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {HubDependent} from "../../abstract/HubDependent.sol";
import {INamed} from "../../interfaces/INamed.sol";
import {IVersioned} from "../../interfaces/IVersioned.sol";
import {ParanetLib} from "../../libraries/ParanetLib.sol";

contract ParanetKnowledgeCollectionsRegistry is INamed, IVersioned, HubDependent {
    string private constant _NAME = "ParanetknowledgeCollectionIdRegistry";
    string private constant _VERSION = "1.0.1";

    // Knowledge Collection ID => Knowledge Collection On Paranet
    mapping(bytes32 => ParanetLib.KnowledgeCollection) internal knowledgeCollections;

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) HubDependent(hubAddress) {}

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function addKnowledgeCollection(
        bytes32 paranetId,
        address knowledgeCollectionStorageContract,
        uint256 knowledgeCollectionTokenId,
        address miner
    ) external onlyContracts returns (bytes32) {
        bytes32 kcId = keccak256(abi.encodePacked(knowledgeCollectionStorageContract, knowledgeCollectionTokenId));
        knowledgeCollections[kcId] = ParanetLib.KnowledgeCollection({
            knowledgeCollectionStorageContract: knowledgeCollectionStorageContract,
            knowledgeCollectionTokenId: knowledgeCollectionTokenId,
            minerAddress: miner,
            paranetId: paranetId
        });

        return kcId;
    }

    function removeKnowledgeCollection(bytes32 knowledgeCollectionId) external onlyContracts {
        delete knowledgeCollections[knowledgeCollectionId];
    }

    function isParanetKnowledgeCollection(bytes32 knowledgeCollectionId) external view returns (bool) {
        return
            keccak256(
                abi.encodePacked(
                    knowledgeCollections[knowledgeCollectionId].knowledgeCollectionStorageContract,
                    knowledgeCollections[knowledgeCollectionId].knowledgeCollectionTokenId
                )
            ) == knowledgeCollectionId;
    }

    function getKnowledgeCollectionObject(
        bytes32 knowledgeCollectionId
    ) external view returns (ParanetLib.KnowledgeCollection memory) {
        return knowledgeCollections[knowledgeCollectionId];
    }

    function getKnowledgeCollectionLocator(bytes32 knowledgeCollectionId) external view returns (address, uint256) {
        return (
            knowledgeCollections[knowledgeCollectionId].knowledgeCollectionStorageContract,
            knowledgeCollections[knowledgeCollectionId].knowledgeCollectionTokenId
        );
    }

    function getKnowledgeCollectionLocators(
        bytes32[] calldata knowledgeCollectionIds
    ) external view returns (ParanetLib.UniversalAssetCollectionLocator[] memory) {
        uint256 length = knowledgeCollectionIds.length;

        ParanetLib.UniversalAssetCollectionLocator[] memory locators = new ParanetLib.UniversalAssetCollectionLocator[](
            length
        );

        for (uint256 i = 0; i < length; i++) {
            bytes32 id = knowledgeCollectionIds[i];

            locators[i] = ParanetLib.UniversalAssetCollectionLocator({
                knowledgeCollectionStorageContract: knowledgeCollections[id].knowledgeCollectionStorageContract,
                knowledgeCollectionTokenId: knowledgeCollections[id].knowledgeCollectionTokenId
            });
        }

        return locators;
    }

    function getMinerAddress(bytes32 knowledgeCollectionId) external view returns (address) {
        return knowledgeCollections[knowledgeCollectionId].minerAddress;
    }

    function setMinerAddress(bytes32 knowledgeCollectionId, address minerAddress) external onlyContracts {
        knowledgeCollections[knowledgeCollectionId].minerAddress = minerAddress;
    }

    function getParanetId(bytes32 knowledgeCollectionId) external view returns (bytes32) {
        return knowledgeCollections[knowledgeCollectionId].paranetId;
    }

    function setParanetId(bytes32 knowledgeCollectionId, bytes32 paranetId) external onlyContracts {
        knowledgeCollections[knowledgeCollectionId].paranetId = paranetId;
    }
}
