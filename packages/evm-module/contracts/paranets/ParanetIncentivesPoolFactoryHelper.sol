// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {Hub} from "../storage/Hub.sol";
import {ParanetIncentivesPool} from "./ParanetIncentivesPool.sol";
import {ParanetIncentivesPoolStorage} from "./ParanetIncentivesPoolStorage.sol";
import {KnowledgeCollectionStorage} from "../storage/KnowledgeCollectionStorage.sol";
import {ContractStatus} from "../abstract/ContractStatus.sol";
import {IInitializable} from "../interfaces/IInitializable.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";

contract ParanetIncentivesPoolFactoryHelper is INamed, IVersioned, ContractStatus {
    string private constant _NAME = "ParanetIncentivesPoolFactoryHelper";
    string private constant _VERSION = "1.0.0";

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) ContractStatus(hubAddress) {}

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function deployIncentivesPool(
        address storageAddress,
        uint256 tracToTokenEmissionMultiplier,
        address poolStorageAddress
    ) external onlyContracts returns (address) {
        address addr = address(
            new ParanetIncentivesPool(
                address(hub),
                hub.getContractAddress("ParanetKnowledgeMinersRegistry"),
                storageAddress,
                hub.getContractAddress("ParanetsRegistry"),
                tracToTokenEmissionMultiplier
            )
        );
        ParanetIncentivesPoolStorage(payable(poolStorageAddress)).setParanetIncentivesPool(addr);

        return addr;
    }
}
