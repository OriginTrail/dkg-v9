// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {HubDependent} from "../../abstract/HubDependent.sol";
import {INamed} from "../../interfaces/INamed.sol";
import {IVersioned} from "../../interfaces/IVersioned.sol";
import {ParanetLib} from "../../libraries/ParanetLib.sol";

contract ParanetServicesRegistry is INamed, IVersioned, HubDependent {
    string private constant _NAME = "ParanetServicesRegistry";
    string private constant _VERSION = "1.0.0";

    // Paranet Service ID => Paranet Service Object
    mapping(bytes32 => ParanetLib.ParanetService) internal paranetServices;

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) HubDependent(hubAddress) {}

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function registerParanetService(
        address paranetServiceKCStorageContract,
        uint256 paranetServiceKCTokenId,
        uint256 paranetServiceKATokenId,
        string calldata paranetServiceName,
        string calldata paranetServiceDescription,
        address[] calldata paranetServiceAddresses
    ) external onlyContracts returns (bytes32) {
        bytes32 paranetServiceId = keccak256(
            abi.encodePacked(paranetServiceKCStorageContract, paranetServiceKCTokenId, paranetServiceKATokenId)
        );
        ParanetLib.ParanetService storage paranetService = paranetServices[paranetServiceId];

        paranetService.paranetServiceKCStorageContract = paranetServiceKCStorageContract;
        paranetService.paranetServiceKCTokenId = paranetServiceKCTokenId;
        paranetService.paranetServiceKATokenId = paranetServiceKATokenId;
        paranetService.name = paranetServiceName;
        paranetService.description = paranetServiceDescription;
        paranetService.paranetServiceAddresses = paranetServiceAddresses;

        for (uint256 i; i < paranetServiceAddresses.length; ) {
            paranetService.paranetServiceAddressRegistered[paranetServiceAddresses[i]] = true;

            unchecked {
                i++;
            }
        }

        return paranetServiceId;
    }

    function deleteParanetService(bytes32 paranetServiceId) external onlyContracts {
        delete paranetServices[paranetServiceId];
    }

    function paranetServiceExists(bytes32 paranetServiceId) external view returns (bool) {
        return
            keccak256(
                abi.encodePacked(
                    paranetServices[paranetServiceId].paranetServiceKCStorageContract,
                    paranetServices[paranetServiceId].paranetServiceKCTokenId,
                    paranetServices[paranetServiceId].paranetServiceKATokenId
                )
            ) == paranetServiceId;
    }

    function getParanetServiceMetadata(
        bytes32 paranetServiceId
    ) external view returns (ParanetLib.ParanetServiceMetadata memory) {
        return
            ParanetLib.ParanetServiceMetadata({
                paranetServiceKCStorageContract: paranetServices[paranetServiceId].paranetServiceKCStorageContract,
                paranetServiceKCTokenId: paranetServices[paranetServiceId].paranetServiceKCTokenId,
                paranetServiceKATokenId: paranetServices[paranetServiceId].paranetServiceKATokenId,
                name: paranetServices[paranetServiceId].name,
                description: paranetServices[paranetServiceId].description,
                paranetServiceAddresses: paranetServices[paranetServiceId].paranetServiceAddresses
            });
    }

    function getParanetServiceKnowledgeCollectionLocator(
        bytes32 paranetServiceId
    ) external view returns (address, uint256, uint256) {
        return (
            paranetServices[paranetServiceId].paranetServiceKCStorageContract,
            paranetServices[paranetServiceId].paranetServiceKCTokenId,
            paranetServices[paranetServiceId].paranetServiceKATokenId
        );
    }

    function getName(bytes32 paranetServiceId) external view returns (string memory) {
        return paranetServices[paranetServiceId].name;
    }

    function setName(bytes32 paranetServiceId, string calldata name_) external onlyContracts {
        paranetServices[paranetServiceId].name = name_;
    }

    function getDescription(bytes32 paranetServiceId) external view returns (string memory) {
        return paranetServices[paranetServiceId].description;
    }

    function setDescription(bytes32 paranetServiceId, string calldata description_) external onlyContracts {
        paranetServices[paranetServiceId].description = description_;
    }

    function getParanetServiceAddresses(bytes32 paranetServiceId) external view returns (address[] memory) {
        return paranetServices[paranetServiceId].paranetServiceAddresses;
    }

    function setParanetServiceAddresses(
        bytes32 paranetServiceId,
        address[] calldata paranetServiceAddresses
    ) external onlyContracts {
        paranetServices[paranetServiceId].paranetServiceAddresses = paranetServiceAddresses;
    }

    function isParanetServiceAddressRegistered(
        bytes32 paranetServiceId,
        address paranetServiceAddress
    ) external view returns (bool) {
        return paranetServices[paranetServiceId].paranetServiceAddressRegistered[paranetServiceAddress];
    }

    function setIsParanetServiceAddressRegistered(
        bytes32 paranetServiceId,
        address paranetServiceAddress,
        bool isRegistered
    ) external onlyContracts {
        paranetServices[paranetServiceId].paranetServiceAddressRegistered[paranetServiceAddress] = isRegistered;
    }
}
