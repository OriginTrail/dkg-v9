// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

library Permissions {
    error OnlyHubFunction(address caller);
    error OnlyHubContractsFunction(address caller);
    error OnlyProfileOperationalWalletFunction(address caller);
    error OnlyProfileAdminFunction(address caller);
    error OnlyProfileAdminOrOperationalAddressesFunction(address caller);
    error OnlyWhitelistedAddressesFunction(address caller);
}
