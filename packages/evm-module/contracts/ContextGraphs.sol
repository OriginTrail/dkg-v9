// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {ContractStatus} from "./abstract/ContractStatus.sol";
import {IDKGPublishingConvictionNFT} from "./interfaces/IDKGPublishingConvictionNFT.sol";
import {IInitializable} from "./interfaces/IInitializable.sol";
import {INamed} from "./interfaces/INamed.sol";
import {IVersioned} from "./interfaces/IVersioned.sol";
import {ContextGraphStorage} from "./storage/ContextGraphStorage.sol";
import {KnowledgeAssetsLib} from "./libraries/KnowledgeAssetsLib.sol";

/**
 * @title ContextGraphs
 * @notice Stateless logic facade for Context Graph operations. All state lives in
 *         ContextGraphStorage (ERC-721 registry). This contract is replaceable via Hub.
 *
 * @dev V10 Phase 7 Task 2: the legacy `addBatchToContextGraph` attestation /
 *      inclusion-proof path is REMOVED (closes audit H2). Participants are
 *      split into hosting nodes (uint72 identity IDs — quorum attesters) and
 *      participant agents (EOA allow-list used for curated / PCA flows).
 *
 *      Publish authorization supports the three curator types encoded in
 *      ContextGraphStorage (see decision #22):
 *
 *        1. EOA    — publishAuthority = wallet, accountId = 0
 *        2. Safe   — publishAuthority = multisig contract, accountId = 0
 *                    (Safe executes txs as msg.sender, so address equality
 *                    works transparently; ERC-1271 is not required here)
 *        3. PCA    — publishAuthority = PCA account-owner marker,
 *                    accountId = DKGPublishingConvictionNFT account id;
 *                    the caller must be a registered agent of that account.
 *
 *      The NFT reference is resolved from the Hub on every authorization
 *      check so that a Phase 6 deployment made *after* the Phase 7 facade
 *      starts working without a facade redeployment.
 *
 *      N17 note: KAV10's current callsite still passes the recovered node
 *      signer wallet into `isAuthorizedPublisher`. That's a Phase 8 fix at
 *      the caller — this facade is responsible for the logic being correct
 *      when a correct principal is supplied.
 */
contract ContextGraphs is INamed, IVersioned, ContractStatus, IInitializable {
    string private constant _NAME = "ContextGraphs";
    string private constant _VERSION = "1.0.0";

    ContextGraphStorage public contextGraphStorage;

    constructor(address hubAddress) ContractStatus(hubAddress) {}

    function initialize() public onlyHub {
        contextGraphStorage = ContextGraphStorage(
            hub.getAssetStorageAddress("ContextGraphStorage")
        );
    }

    function name() public pure virtual returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual returns (string memory) {
        return _VERSION;
    }

    // --- Creation ---

    /**
     * @notice Create a new context graph. Mints an ERC-721 to msg.sender.
     * @param hostingNodes              Sorted ascending node identity IDs (storage attestation set)
     * @param participantAgents         EOA allow-list (no zeros, no dups)
     * @param requiredSignatures        M-of-N quorum (≤ hostingNodes.length)
     * @param metadataBatchId           Batch ID describing the CG metadata (0 if none)
     * @param publishPolicy             0 = curated, 1 = open
     * @param publishAuthority          Curator address (required when curated; ignored when open)
     * @param publishAuthorityAccountId Non-zero -> PCA curator type. Requires curated. Ignored when open.
     * @return contextGraphId           Newly assigned context graph ID (= ERC-721 token ID)
     */
    function createContextGraph(
        uint72[] calldata hostingNodes,
        address[] calldata participantAgents,
        uint8 requiredSignatures,
        uint256 metadataBatchId,
        uint8 publishPolicy,
        address publishAuthority,
        uint256 publishAuthorityAccountId
    ) external returns (uint256 contextGraphId) {
        // Storage validates sorting/dedup/zero-rejection, but a friendly
        // default for curated CGs: if caller passes zero authority and the
        // policy is curated, use msg.sender.
        address authority = publishAuthority;
        if (publishPolicy == 0 && authority == address(0)) {
            authority = msg.sender;
        }

        contextGraphId = contextGraphStorage.createContextGraph(
            msg.sender,
            hostingNodes,
            participantAgents,
            requiredSignatures,
            metadataBatchId,
            publishPolicy,
            authority,
            publishAuthorityAccountId
        );
    }

    // --- Governance (token-holder gated) ---

    modifier onlyContextGraphOwner(uint256 contextGraphId) {
        if (contextGraphStorage.getContextGraphOwner(contextGraphId) != msg.sender) {
            revert KnowledgeAssetsLib.NotContextGraphOwner(contextGraphId, msg.sender);
        }
        _;
    }

    /**
     * @notice Allow either the NFT owner or the configured curator to
     *         mutate the participant-agent allow-list.
     * @dev For open-policy CGs `publishAuthority` is `address(0)`, so only
     *      the owner branch can ever pass — the authority comparison is dead
     *      code in that case. This matches the design: open CGs don't have
     *      curators, and agent allow-lists only matter for curated flows.
     */
    modifier onlyContextGraphOwnerOrAuthority(uint256 contextGraphId) {
        address cgOwner = contextGraphStorage.getContextGraphOwner(contextGraphId);
        (, address authority) = contextGraphStorage.getPublishPolicy(contextGraphId);
        if (msg.sender != cgOwner && msg.sender != authority) {
            revert KnowledgeAssetsLib.NotContextGraphOwnerOrAuthority(contextGraphId, msg.sender);
        }
        _;
    }

    function updatePublishPolicy(
        uint256 contextGraphId,
        uint8 publishPolicy,
        address publishAuthority,
        uint256 publishAuthorityAccountId
    ) external onlyContextGraphOwner(contextGraphId) {
        contextGraphStorage.updatePublishPolicy(
            contextGraphId,
            publishPolicy,
            publishAuthority,
            publishAuthorityAccountId
        );
    }

    function updatePublishAuthority(
        uint256 contextGraphId,
        address newAuthority,
        uint256 newAuthorityAccountId
    ) external onlyContextGraphOwner(contextGraphId) {
        contextGraphStorage.updatePublishAuthority(
            contextGraphId,
            newAuthority,
            newAuthorityAccountId
        );
    }

    function setHostingNodes(
        uint256 contextGraphId,
        uint72[] calldata nodes
    ) external onlyContextGraphOwner(contextGraphId) {
        contextGraphStorage.setHostingNodes(contextGraphId, nodes);
    }

    function addParticipantAgent(
        uint256 contextGraphId,
        address agent
    ) external onlyContextGraphOwnerOrAuthority(contextGraphId) {
        contextGraphStorage.addParticipantAgent(contextGraphId, agent);
    }

    function removeParticipantAgent(
        uint256 contextGraphId,
        address agent
    ) external onlyContextGraphOwnerOrAuthority(contextGraphId) {
        contextGraphStorage.removeParticipantAgent(contextGraphId, agent);
    }

    function updateQuorum(
        uint256 contextGraphId,
        uint8 requiredSignatures
    ) external onlyContextGraphOwner(contextGraphId) {
        contextGraphStorage.updateQuorum(contextGraphId, requiredSignatures);
    }

    // --- Publish authorization ---

    /**
     * @notice Check whether `publisher` is authorized to publish to a context graph.
     *
     * @dev Implements the 3-curator-type model per decision #22:
     *
     *      - Open CGs (publishPolicy == 1) allow any non-zero principal.
     *      - Curated + EOA curator: direct address equality against authority.
     *      - Curated + Safe multisig: same direct address equality. A Gnosis
     *        Safe IS `msg.sender` when it executes a transaction, so any
     *        call made on behalf of the Safe arrives here with
     *        `publisher == safeAddress`. No ERC-1271 signature check is
     *        required at this layer.
     *      - Curated + PCA: the CG's `publishAuthorityAccountId` is non-zero
     *        and points to a DKGPublishingConvictionNFT account id. The
     *        caller passes the authorization if they are a registered agent
     *        of that same account id (mapping-based lookup on the NFT).
     *
     *      The DKGPublishingConvictionNFT reference is resolved on every call
     *      via a `try/catch` on `hub.getContractAddress("DKGPublishingConvictionNFT")`.
     *      Hub's `getContractAddress` reverts with `ContractDoesNotExist` when
     *      the contract is not registered (see UnorderedNamedContractDynamicSet.get),
     *      so the catch branch handles gracefully-degraded environments where
     *      Phase 6 has not been deployed yet. Using a fresh lookup each call
     *      (rather than caching on `initialize()`) lets the PCA branch start
     *      working without a facade redeployment once Phase 6 lands.
     *
     *      View-only — no state mutations.
     *
     *      N17 note: the external signature intentionally matches the V9
     *      callsite at KAV10.sol:188 (`(uint256, address)`). The bug that
     *      KAV10 passes `publisherWallet` (the recovered node signer)
     *      instead of the paying principal is a Phase 8 caller-side fix.
     */
    function isAuthorizedPublisher(
        uint256 contextGraphId,
        address publisher
    ) external view returns (bool) {
        // 0. Bounds + liveness.
        uint256 latestId = contextGraphStorage.getLatestContextGraphId();
        if (contextGraphId == 0 || contextGraphId > latestId) return false;
        if (!contextGraphStorage.isContextGraphActive(contextGraphId)) return false;

        // 1. Open CGs authorize any non-zero principal.
        (uint8 policy, address authority) = contextGraphStorage.getPublishPolicy(contextGraphId);
        if (policy == 1) {
            return publisher != address(0);
        }

        // 2. Curated: never authorize the zero address.
        if (publisher == address(0)) return false;

        // 3. EOA / Safe: direct address match.
        //    A Safe executing a tx arrives here as `msg.sender == safeAddress`,
        //    which the caller forwards as `publisher` in the N17-correct flow.
        if (publisher == authority) return true;

        // 4. PCA curator type: stored accountId non-zero. Resolve the
        //    DKGPublishingConvictionNFT from the Hub on every call so a
        //    post-Phase-7 Phase 6 deployment activates the branch without
        //    facade redeployment. A missing registration reverts in Hub,
        //    so try/catch the graceful-degrade branch.
        uint256 authorityAccountId = contextGraphStorage.getPublishAuthorityAccountId(contextGraphId);
        if (authorityAccountId == 0) return false;

        address nftAddr;
        try hub.getContractAddress("DKGPublishingConvictionNFT") returns (address addr) {
            nftAddr = addr;
        } catch {
            return false;
        }
        if (nftAddr == address(0)) return false;

        uint256 publisherAccountId = IDKGPublishingConvictionNFT(nftAddr).agentToAccountId(publisher);
        return publisherAccountId != 0 && publisherAccountId == authorityAccountId;
    }
}
