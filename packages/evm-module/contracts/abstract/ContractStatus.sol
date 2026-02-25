// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {HubDependent} from "./HubDependent.sol";

abstract contract ContractStatus is HubDependent {
    bool public status;

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) HubDependent(hubAddress) {}

    function setStatus(bool _status) external onlyHub {
        status = _status;
    }
}
