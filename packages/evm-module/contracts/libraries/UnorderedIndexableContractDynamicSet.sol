// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {IIndexable} from "../interfaces/IIndexable.sol";

library UnorderedIndexableContractDynamicSet {
    struct Contract {
        uint8 id;
        address addr;
    }

    struct Set {
        mapping(uint8 => uint256) indexPointers;
        Contract[] contractList;
    }

    error ZeroId();
    error ZeroAddress();
    error ContractAlreadyExists(uint8 id);
    error ContractDoesNotExist(uint8 id);

    function append(Set storage self, uint8 id, address addr) internal {
        if (id == 0) revert ZeroId();
        if (addr == address(0)) revert ZeroAddress();
        if (exists(self, id)) revert ContractAlreadyExists(id);

        self.indexPointers[id] = size(self);
        self.contractList.push(Contract(id, addr));
    }

    function update(Set storage self, uint8 id, address addr) internal {
        if (addr == address(0)) revert ZeroAddress();
        if (!exists(self, id)) revert ContractDoesNotExist(id);

        self.contractList[self.indexPointers[id]].addr = addr;
    }

    function remove(Set storage self, uint8 id) internal {
        if (!exists(self, id)) revert ContractDoesNotExist(id);

        uint256 contractToRemoveIndex = self.indexPointers[id];
        Contract memory contractToMove = self.contractList[size(self) - 1];
        uint8 contractToMoveId = IIndexable(contractToMove.addr).id();

        self.indexPointers[contractToMoveId] = contractToRemoveIndex;
        self.contractList[contractToRemoveIndex] = contractToMove;

        delete self.indexPointers[id];
        self.contractList.pop();
    }

    function get(Set storage self, uint8 id) internal view returns (Contract memory) {
        if (!exists(self, id)) revert ContractDoesNotExist(id);

        return self.contractList[self.indexPointers[id]];
    }

    function getAll(Set storage self) internal view returns (Contract[] memory) {
        return self.contractList;
    }

    function getIndex(Set storage self, uint8 id) internal view returns (uint256) {
        return self.indexPointers[id];
    }

    function getByIndex(Set storage self, uint256 index) internal view returns (Contract memory) {
        return self.contractList[index];
    }

    function exists(Set storage self, uint8 id) internal view returns (bool) {
        if (size(self) == 0) {
            return false;
        }
        return self.contractList[self.indexPointers[id]].id == id;
    }

    function size(Set storage self) internal view returns (uint256) {
        return self.contractList.length;
    }
}
