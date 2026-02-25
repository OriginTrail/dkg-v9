// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

library ByteArr {
    error IndexOutOfBounds(uint256 index, uint256 length);

    function indexOf(bytes32[] storage self, bytes32 item) internal view returns (uint256 index, bool isThere) {
        for (uint256 i; i < self.length; i++) {
            if (self[i] == item) {
                return (i, true);
            }
        }
        return (0, false);
    }

    function removeByIndex(bytes32[] storage self, uint256 index) internal returns (bytes32[] memory) {
        if (index >= self.length) {
            revert IndexOutOfBounds(index, self.length);
        }

        self[index] = self[self.length - 1];
        self.pop();

        return self;
    }

    function getFuncHash(bytes storage _data) internal view returns (bytes4) {
        bytes4 output;
        for (uint256 i; i < 4; i++) {
            output |= bytes4(_data[i] & 0xFF) >> (i * 8);
        }
        return output;
    }
}
