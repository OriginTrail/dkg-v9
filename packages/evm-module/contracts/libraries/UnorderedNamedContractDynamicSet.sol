// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

library UnorderedNamedContractDynamicSet {
    struct Contract {
        string name;
        address addr;
    }

    struct Set {
        mapping(string => uint256) stringIndexPointers;
        mapping(address => uint256) addressIndexPointers;
        Contract[] contractList;
    }

    error EmptyName();
    error ZeroAddress();
    error ContractAlreadyExists(string name);
    error AddressAlreadyInSet(address addr);
    error ContractDoesNotExist(string name);
    error AddressDoesNotExist(address addr);

    function append(UnorderedNamedContractDynamicSet.Set storage self, string calldata name, address addr) internal {
        if (keccak256(abi.encodePacked(name)) == keccak256(abi.encodePacked(""))) revert EmptyName();
        if (addr == address(0)) revert ZeroAddress();
        if (exists(self, name)) revert ContractAlreadyExists(name);
        if (self.contractList.length > 0 && (self.addressIndexPointers[addr] != 0 || self.contractList[0].addr == addr))
            revert AddressAlreadyInSet(addr);

        self.stringIndexPointers[name] = size(self);
        self.addressIndexPointers[addr] = size(self);
        self.contractList.push(UnorderedNamedContractDynamicSet.Contract(name, addr));
    }

    function update(UnorderedNamedContractDynamicSet.Set storage self, string calldata name, address addr) internal {
        if (addr == address(0)) revert ZeroAddress();
        if (!exists(self, name)) revert ContractDoesNotExist(name);
        if (self.contractList.length > 0 && (self.addressIndexPointers[addr] != 0 || self.contractList[0].addr == addr))
            revert AddressAlreadyInSet(addr);

        delete self.addressIndexPointers[self.contractList[self.stringIndexPointers[name]].addr];
        self.addressIndexPointers[addr] = self.stringIndexPointers[name];
        self.contractList[self.stringIndexPointers[name]].addr = addr;
    }

    function remove(UnorderedNamedContractDynamicSet.Set storage self, string calldata name) internal {
        if (!exists(self, name)) revert ContractDoesNotExist(name);

        uint256 contractToRemoveIndex = self.stringIndexPointers[name];

        delete self.addressIndexPointers[self.contractList[contractToRemoveIndex].addr];

        UnorderedNamedContractDynamicSet.Contract memory contractToMove = self.contractList[size(self) - 1];

        self.stringIndexPointers[contractToMove.name] = contractToRemoveIndex;
        self.addressIndexPointers[contractToMove.addr] = contractToRemoveIndex;
        self.contractList[contractToRemoveIndex] = contractToMove;

        delete self.stringIndexPointers[name];
        self.contractList.pop();
    }

    function remove(UnorderedNamedContractDynamicSet.Set storage self, address addr) internal {
        if (!exists(self, addr)) revert AddressDoesNotExist(addr);

        uint256 contractToRemoveIndex = self.addressIndexPointers[addr];

        delete self.stringIndexPointers[self.contractList[contractToRemoveIndex].name];

        UnorderedNamedContractDynamicSet.Contract memory contractToMove = self.contractList[size(self) - 1];

        self.stringIndexPointers[contractToMove.name] = contractToRemoveIndex;
        self.addressIndexPointers[contractToMove.addr] = contractToRemoveIndex;
        self.contractList[contractToRemoveIndex] = contractToMove;

        delete self.addressIndexPointers[addr];
        self.contractList.pop();
    }

    function get(
        UnorderedNamedContractDynamicSet.Set storage self,
        string calldata name
    ) internal view returns (UnorderedNamedContractDynamicSet.Contract memory) {
        if (!exists(self, name)) revert ContractDoesNotExist(name);

        return self.contractList[self.stringIndexPointers[name]];
    }

    function get(
        UnorderedNamedContractDynamicSet.Set storage self,
        address addr
    ) internal view returns (UnorderedNamedContractDynamicSet.Contract memory) {
        if (!exists(self, addr)) revert AddressDoesNotExist(addr);

        return self.contractList[self.addressIndexPointers[addr]];
    }

    function get(
        UnorderedNamedContractDynamicSet.Set storage self,
        uint256 index
    ) internal view returns (UnorderedNamedContractDynamicSet.Contract memory) {
        return self.contractList[index];
    }

    function getAll(
        UnorderedNamedContractDynamicSet.Set storage self
    ) internal view returns (UnorderedNamedContractDynamicSet.Contract[] memory) {
        return self.contractList;
    }

    function getIndex(
        UnorderedNamedContractDynamicSet.Set storage self,
        string calldata name
    ) internal view returns (uint256) {
        return self.stringIndexPointers[name];
    }

    function getIndex(UnorderedNamedContractDynamicSet.Set storage self, address addr) internal view returns (uint256) {
        return self.addressIndexPointers[addr];
    }

    function exists(
        UnorderedNamedContractDynamicSet.Set storage self,
        string calldata name
    ) internal view returns (bool) {
        if (size(self) == 0) {
            return false;
        }
        return
            keccak256(abi.encodePacked(self.contractList[self.stringIndexPointers[name]].name)) ==
            keccak256(abi.encodePacked(name));
    }

    function exists(UnorderedNamedContractDynamicSet.Set storage self, address addr) internal view returns (bool) {
        if (size(self) == 0) {
            return false;
        }
        return addr == self.contractList[self.addressIndexPointers[addr]].addr;
    }

    function size(UnorderedNamedContractDynamicSet.Set storage self) internal view returns (uint256) {
        return self.contractList.length;
    }
}
