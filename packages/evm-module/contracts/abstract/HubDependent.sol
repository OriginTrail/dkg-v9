// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {Hub} from "../storage/Hub.sol";
import {HubLib} from "../libraries/HubLib.sol";

abstract contract HubDependent {
    Hub public hub;

    constructor(address hubAddress) {
        if (hubAddress == address(0)) {
            revert HubLib.ZeroAddressHub();
        }

        hub = Hub(hubAddress);
    }

    modifier onlyHub() {
        _checkHub();
        _;
    }

    modifier onlyHubOwner() {
        _checkHubOwner();
        _;
    }

    modifier onlyContracts() {
        _checkHubContract();
        _;
    }

    function _checkHub() internal view virtual {
        if (msg.sender != address(hub) && msg.sender != hub.owner()) {
            revert HubLib.UnauthorizedAccess("Only Hub");
        }
    }

    function _checkHubOwner() internal view virtual {
        if (msg.sender != hub.owner()) {
            revert HubLib.UnauthorizedAccess("Only Hub Owner");
        }
    }

    function _checkHubContract() internal view virtual {
        if (!hub.isContract(msg.sender) && msg.sender != hub.owner()) {
            revert HubLib.UnauthorizedAccess("Only Contracts in Hub");
        }
    }
}
