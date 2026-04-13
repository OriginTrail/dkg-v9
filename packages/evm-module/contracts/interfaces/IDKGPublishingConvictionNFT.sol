// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

/**
 * @title IDKGPublishingConvictionNFT
 * @notice Minimal interface over DKGPublishingConvictionNFT for dependency inversion.
 *
 * @dev ContextGraphs resolves a PCA agent -> account mapping when checking
 *      publish authorization for PCA curator type. Using a minimal interface
 *      (single view getter) instead of importing the full contract avoids a
 *      cross-module circular import risk and keeps the facade replaceable.
 *
 *      The mapping is declared `public` in DKGPublishingConvictionNFT, so the
 *      auto-generated getter returns the account id for a registered agent
 *      (zero if the agent is not registered).
 */
interface IDKGPublishingConvictionNFT {
    /// @notice Returns the account id a given agent is registered under, or 0.
    function agentToAccountId(address agent) external view returns (uint256);
}
