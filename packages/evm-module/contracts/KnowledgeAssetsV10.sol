// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AskStorage} from "./storage/AskStorage.sol";
import {EpochStorage} from "./storage/EpochStorage.sol";
import {PaymasterManager} from "./storage/PaymasterManager.sol";
import {Chronos} from "./storage/Chronos.sol";
import {KnowledgeCollectionStorage} from "./storage/KnowledgeCollectionStorage.sol";
import {IdentityStorage} from "./storage/IdentityStorage.sol";
import {ParametersStorage} from "./storage/ParametersStorage.sol";
import {StakingStorage} from "./storage/StakingStorage.sol";
import {ContextGraphs} from "./ContextGraphs.sol";
import {ContextGraphValueStorage} from "./storage/ContextGraphValueStorage.sol";
import {KnowledgeAssetsLib} from "./libraries/KnowledgeAssetsLib.sol";
import {ParanetKnowledgeCollectionsRegistry} from "./storage/paranets/ParanetKnowledgeCollectionsRegistry.sol";
import {ParanetKnowledgeMinersRegistry} from "./storage/paranets/ParanetKnowledgeMinersRegistry.sol";
import {ParanetsRegistry} from "./storage/paranets/ParanetsRegistry.sol";
import {KnowledgeCollectionLib} from "./libraries/KnowledgeCollectionLib.sol";
import {TokenLib} from "./libraries/TokenLib.sol";
import {IdentityLib} from "./libraries/IdentityLib.sol";
import {INamed} from "./interfaces/INamed.sol";
import {IPaymaster} from "./interfaces/IPaymaster.sol";
import {IVersioned} from "./interfaces/IVersioned.sol";
import {IInitializable} from "./interfaces/IInitializable.sol";
import {IDKGPublishingConvictionNFT} from "./interfaces/IDKGPublishingConvictionNFT.sol";
import {ContractStatus} from "./abstract/ContractStatus.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ECDSA} from "solady/src/utils/ECDSA.sol";

/**
 * @title KnowledgeAssetsV10
 * @notice V10 publish contract — wires together:
 *   - ContextGraphs facade (3 curator types, atomic KC↔CG bind)
 *   - ContextGraphValueStorage (per-CG value ledger for value-weighted challenges)
 *   - DKGPublishingConvictionNFT (publisher discount NFT; auto-resolves agent→account)
 *   - KnowledgeCollectionStorage (V8-compatible data model)
 *
 * Two public entry points:
 *   - `publish`        — conviction path. NFT covers the cost. TRAC accounting
 *                        was already done at `createAccount` time, so this
 *                        path does NOT touch `_addTokens` or `_distributeTokens`
 *                        (double-count prevention).
 *   - `publishDirect`  — market-rate path. Pulls TRAC from caller/paymaster
 *                        and distributes across the epoch range via
 *                        `_distributeTokens`.
 *
 * Both paths share the core sequence (sig verification → auth → validate →
 * KCS create → atomic CG bind → CG value write → per-node produced-value
 * bookkeeping) via the internal `_executePublishCore` helper.
 *
 * ACK digest prefix (H5 closure): `block.chainid || address(this)` pins a
 * signed ACK to this contract on this chain. Replay across chains / forks
 * / contract redeployments is rejected at signature verification.
 *
 * Publisher digest field order (N26 closure): `(publisherNodeIdentityId,
 * contextGraphId, merkleRoot)` — matches spec `07_EVM_MODULE.md:164`.
 *
 * Authorization (N17 closure): `isAuthorizedPublisher` is called with
 * `msg.sender` (the paying principal), NOT the recovered node signer.
 */
contract KnowledgeAssetsV10 is INamed, IVersioned, ContractStatus, IInitializable {
    string private constant _NAME = "KnowledgeAssetsV10";
    string private constant _VERSION = "10.0.0";

    // --- V10 publish input (grouped to bypass the 16-arg stack limit) ---

    struct PublishParams {
        string publishOperationId;
        uint256 contextGraphId;
        bytes32 merkleRoot;
        uint256 knowledgeAssetsAmount;
        uint88 byteSize;
        uint40 epochs;
        uint96 tokenAmount;
        bool isImmutable;
        uint72 publisherNodeIdentityId;
        bytes32 publisherNodeR;
        bytes32 publisherNodeVS;
        uint72[] identityIds;
        bytes32[] r;
        bytes32[] vs;
    }

    // --- Hub-resolved dependencies ---

    AskStorage public askStorage;
    EpochStorage public epochStorage;
    PaymasterManager public paymasterManager;
    ParanetKnowledgeCollectionsRegistry public paranetKnowledgeCollectionsRegistry;
    ParanetKnowledgeMinersRegistry public paranetKnowledgeMinersRegistry;
    ParanetsRegistry public paranetsRegistry;
    KnowledgeCollectionStorage public knowledgeCollectionStorage;
    Chronos public chronos;
    IERC20 public tokenContract;
    ParametersStorage public parametersStorage;
    IdentityStorage public identityStorage;
    ContextGraphs public contextGraphs;
    ContextGraphValueStorage public contextGraphValueStorage;
    IDKGPublishingConvictionNFT public publishingConvictionNFT;

    // --- Persistent state ---

    // Tracks the original (maximum) byte size paid for at creation time.
    // Updates can shrink below this but never exceed it without additional payment.
    mapping(uint256 => uint88) public originalByteSize;

    // --- Errors ---

    error ZeroAddressDependency(string name);
    error ZeroContextGraphId();

    constructor(address hubAddress) ContractStatus(hubAddress) {}

    function initialize() public onlyHub {
        askStorage = AskStorage(hub.getContractAddress("AskStorage"));
        epochStorage = EpochStorage(hub.getContractAddress("EpochStorageV8"));
        paymasterManager = PaymasterManager(hub.getContractAddress("PaymasterManager"));
        paranetKnowledgeCollectionsRegistry = ParanetKnowledgeCollectionsRegistry(
            hub.getContractAddress("ParanetKnowledgeCollectionsRegistry")
        );
        paranetKnowledgeMinersRegistry = ParanetKnowledgeMinersRegistry(
            hub.getContractAddress("ParanetKnowledgeMinersRegistry")
        );
        paranetsRegistry = ParanetsRegistry(hub.getContractAddress("ParanetsRegistry"));
        knowledgeCollectionStorage = KnowledgeCollectionStorage(
            hub.getAssetStorageAddress("KnowledgeCollectionStorage")
        );
        chronos = Chronos(hub.getContractAddress("Chronos"));
        tokenContract = IERC20(hub.getContractAddress("Token"));
        parametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        identityStorage = IdentityStorage(hub.getContractAddress("IdentityStorage"));

        // V10 new dependencies — fail-fast. Each MUST be Hub-registered at
        // KAV10 initialize() time. The Phase 7 transitional try/catch tolerance
        // is removed: Phase 8 makes ContextGraphs + CG value + NFT mandatory.

        address cgAddr = hub.getContractAddress("ContextGraphs");
        if (cgAddr == address(0)) revert ZeroAddressDependency("ContextGraphs");
        contextGraphs = ContextGraphs(cgAddr);

        address cgvAddr = hub.getContractAddress("ContextGraphValueStorage");
        if (cgvAddr == address(0)) revert ZeroAddressDependency("ContextGraphValueStorage");
        contextGraphValueStorage = ContextGraphValueStorage(cgvAddr);

        address nftAddr = hub.getContractAddress("DKGPublishingConvictionNFT");
        if (nftAddr == address(0)) revert ZeroAddressDependency("DKGPublishingConvictionNFT");
        publishingConvictionNFT = IDKGPublishingConvictionNFT(nftAddr);
    }

    function name() public pure virtual returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual returns (string memory) {
        return _VERSION;
    }

    // ========================================================================
    // V10 Publish Entries
    // ========================================================================

    /**
     * @notice Publish via publisher conviction account (discounted path).
     *
     * The publishing agent (`msg.sender`) must be registered under an active
     * conviction NFT account via `DKGPublishingConvictionNFT.registerAgent`.
     * The NFT auto-resolves the paying account from `agentToAccountId[msg.sender]`
     * inside `coverPublishingCost` — KAV10 does NOT accept a caller-supplied
     * account id (N28 closure).
     *
     * Double-count prevention (decision #17 + H critical):
     * The NFT's `createAccount` already wrote the full `committedTRAC` into
     * `EpochStorage.addTokensToEpochRange` across the 12-epoch lock window.
     * This path therefore MUST NOT call `_addTokens` or `_distributeTokens` —
     * doing so would double-count TRAC in the staker reward pool.
     *
     * @param p All publish parameters (see `PublishParams` struct).
     * @return kcId Newly created knowledge collection id.
     */
    function publish(PublishParams calldata p) external returns (uint256 kcId) {
        uint40 currentEpoch;
        (currentEpoch, kcId) = _executePublishCore(p);

        // Spend publisher allowance. NFT reverts NoConvictionAccount(msg.sender)
        // if caller is not registered as an agent on any active account.
        // Discounted amount is discarded here — the NFT emits `CostCovered`
        // with full detail for off-chain accounting.
        publishingConvictionNFT.coverPublishingCost(msg.sender, p.tokenAmount);

        // Per-node produced value for scoring. Uses BASE `tokenAmount`, not
        // `discountedCost`: a node's produced-value score reflects the data
        // value the publisher declared, not the cheaper effective spend.
        epochStorage.addEpochProducedKnowledgeValue(p.publisherNodeIdentityId, currentEpoch, p.tokenAmount);

        return kcId;
    }

    /**
     * @notice Publish at market rate (no conviction discount).
     *
     * Pulls TRAC from `msg.sender` (or `paymaster` if valid) and distributes
     * it across the epoch range via `_distributeTokens`. No conviction NFT
     * involvement — nothing to auto-resolve, nothing to double-count.
     *
     * @param p Publish parameters.
     * @param paymaster Paymaster address for cost coverage, or `address(0)`
     *                  to pull from `msg.sender` directly.
     * @return kcId Newly created knowledge collection id.
     */
    function publishDirect(
        PublishParams calldata p,
        address paymaster
    ) external returns (uint256 kcId) {
        (uint40 currentEpoch, uint256 coreKcId) = _executePublishCore(p);

        // Pull funds + distribute to the reward pool across the epoch range.
        _addTokens(p.tokenAmount, paymaster);
        _distributeTokens(p.tokenAmount, p.epochs, currentEpoch);

        // Per-node produced value. BASE amount — same rationale as `publish`.
        epochStorage.addEpochProducedKnowledgeValue(p.publisherNodeIdentityId, currentEpoch, p.tokenAmount);

        return coreKcId;
    }

    // ========================================================================
    // Internal: Shared publish core
    // ========================================================================

    /**
     * @notice Signature verification + auth + validation + KCS create +
     *         atomic CG bind + CG value write.
     *
     * Both `publish` and `publishDirect` run this before branching on
     * payment path. No TRAC movement happens here — the caller's path
     * handles that.
     */
    function _executePublishCore(
        PublishParams calldata p
    ) internal returns (uint40 currentEpoch, uint256 kcId) {
        // --- 1. Signature verification ---

        // Publisher digest (N26: field order = publisherNodeIdentityId, contextGraphId, merkleRoot).
        // H5: prefix with (block.chainid, address(this)) to pin replay to this chain + contract.
        bytes32 publisherDigest = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                p.publisherNodeIdentityId,
                p.contextGraphId,
                p.merkleRoot
            )
        );
        bytes32 publisherEthDigest = ECDSA.toEthSignedMessageHash(publisherDigest);
        _verifySignature(p.publisherNodeIdentityId, publisherEthDigest, p.publisherNodeR, p.publisherNodeVS);

        // ACK digest (H5: same chain/contract prefix as publisher digest).
        bytes32 ackDigest = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                p.publisherNodeIdentityId,
                p.contextGraphId,
                p.merkleRoot,
                p.knowledgeAssetsAmount,
                uint256(p.byteSize),
                uint256(p.epochs),
                uint256(p.tokenAmount)
            )
        );
        _verifySignatures(p.identityIds, ECDSA.toEthSignedMessageHash(ackDigest), p.r, p.vs);

        // Recover publisher wallet from the (already verified) signature.
        // This is the address that actually signed the merkle root — KCS
        // stores it as the merkle-root author, NOT the paying agent.
        address publisherWallet = ECDSA.recover(publisherEthDigest, p.publisherNodeR, p.publisherNodeVS);

        // --- 2. CG existence + validation (revert before any state mutation) ---

        // Decision #3: contextGraphId == 0 is forbidden. No legacy path.
        if (p.contextGraphId == 0) revert ZeroContextGraphId();

        // H7: SafeCast guards the uint96 cast in _validateTokenAmount.
        _validateTokenAmount(p.byteSize, p.epochs, p.tokenAmount, false);

        // N17: pass the PAYING PRINCIPAL (msg.sender of this tx — the
        // publishing agent), NOT the recovered node signer. This is the
        // fix for the V9 bug at KAV10.sol:188 that passed publisherWallet.
        if (!contextGraphs.isAuthorizedPublisher(p.contextGraphId, msg.sender)) {
            revert KnowledgeAssetsLib.UnauthorizedPublisher(p.contextGraphId, msg.sender);
        }

        // --- 3. Create KC in storage ---

        KnowledgeCollectionStorage kcs = knowledgeCollectionStorage;
        currentEpoch = uint40(chronos.getCurrentEpoch());

        kcId = kcs.createKnowledgeCollection(
            publisherWallet,
            p.publishOperationId,
            p.merkleRoot,
            p.knowledgeAssetsAmount,
            p.byteSize,
            currentEpoch,
            currentEpoch + p.epochs,
            p.tokenAmount,
            p.isImmutable
        );

        originalByteSize[kcId] = p.byteSize;

        // --- 4. N20: atomic CG↔KC binding + CG value diff ---

        // Facade write: kcToContextGraph[kcId] = cgId AND contextGraphKCList[cgId].push(kcId).
        contextGraphs.registerKnowledgeCollection(p.contextGraphId, kcId);

        // Per-CG + global value ledger for value-weighted random challenges.
        // Uses BASE `tokenAmount` — value weighting tracks data value, not
        // publisher economics (discounted cost is irrelevant here).
        contextGraphValueStorage.addCGValueForEpochRange(
            p.contextGraphId,
            uint256(currentEpoch),
            uint256(p.epochs),
            uint256(p.tokenAmount)
        );
    }

    // ========================================================================
    // Lifetime Extension (V8-compatible, no ACK change needed)
    // ========================================================================

    function extendKnowledgeCollectionLifetime(
        uint256 id,
        uint40 epochs,
        uint96 tokenAmount,
        address paymaster
    ) external {
        KnowledgeCollectionStorage kcs = knowledgeCollectionStorage;

        (, , , uint88 byteSize, , uint40 endEpoch, uint96 oldTokenAmount, ) = kcs.getKnowledgeCollectionMetadata(id);

        uint256 currentEpoch = chronos.getCurrentEpoch();
        if (currentEpoch > endEpoch) {
            revert KnowledgeCollectionLib.KnowledgeCollectionExpired(id, currentEpoch, endEpoch);
        }

        kcs.setEndEpoch(id, endEpoch + epochs);
        kcs.setTokenAmount(id, oldTokenAmount + tokenAmount);

        _validateTokenAmount(byteSize, epochs, tokenAmount, false);
        epochStorage.addTokensToEpochRange(1, endEpoch, endEpoch + epochs, tokenAmount);
        _addTokens(tokenAmount, paymaster);

        ParanetKnowledgeCollectionsRegistry pkar = paranetKnowledgeCollectionsRegistry;

        bytes32 knowledgeCollectionId = pkar.getParanetId(keccak256(abi.encodePacked(address(kcs), id)));
        if (pkar.isParanetKnowledgeCollection(knowledgeCollectionId)) {
            ParanetKnowledgeMinersRegistry pkmr = paranetKnowledgeMinersRegistry;
            bytes32 paranetId = paranetKnowledgeCollectionsRegistry.getParanetId(knowledgeCollectionId);

            paranetsRegistry.addCumulativeKnowledgeValue(paranetId, tokenAmount);

            pkmr.addCumulativeTracSpent(msg.sender, paranetId, tokenAmount);
            pkmr.addUnrewardedTracSpent(msg.sender, paranetId, tokenAmount);
            pkmr.addTotalTracSpent(msg.sender, tokenAmount);
        }
    }

    // ========================================================================
    // Internal: Signature Verification
    // ========================================================================

    function _verifySignatures(
        uint72[] calldata identityIds,
        bytes32 messageHash,
        bytes32[] calldata r,
        bytes32[] calldata vs
    ) internal view {
        if (r.length != identityIds.length || r.length != vs.length) {
            revert KnowledgeCollectionLib.SignaturesSignersMismatch(r.length, vs.length, identityIds.length);
        }

        uint256 minSigs = parametersStorage.minimumRequiredSignatures();

        if (r.length < minSigs) {
            revert KnowledgeCollectionLib.MinSignaturesRequirementNotMet(minSigs, r.length);
        }

        uint256 uniqueCount;
        for (uint256 i; i < identityIds.length; i++) {
            bool isDuplicate = false;
            for (uint256 j; j < i; j++) {
                if (identityIds[i] == identityIds[j]) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                uniqueCount++;
                if (uniqueCount >= minSigs) break;
            }
        }
        require(uniqueCount >= minSigs, "Insufficient unique receiver identities");

        for (uint256 i; i < identityIds.length; i++) {
            _verifySignature(identityIds[i], messageHash, r[i], vs[i]);
        }
    }

    function _verifySignature(uint72 identityId, bytes32 messageHash, bytes32 _r, bytes32 _vs) internal view {
        address signer = ECDSA.tryRecover(messageHash, _r, _vs);

        if (signer == address(0)) {
            revert KnowledgeCollectionLib.InvalidSignature(identityId, messageHash, _r, _vs);
        }

        if (
            !identityStorage.keyHasPurpose(identityId, keccak256(abi.encodePacked(signer)), IdentityLib.OPERATIONAL_KEY)
        ) {
            revert KnowledgeCollectionLib.SignerIsNotNodeOperator(identityId, signer);
        }

        // Core nodes must be staked (spec §9.0)
        StakingStorage ss = StakingStorage(hub.getContractAddress("StakingStorage"));
        require(ss.getNodeStake(identityId) > 0, "ACK signer has no stake");
    }

    // ========================================================================
    // Internal: Payment
    // ========================================================================

    function _validateTokenAmount(
        uint256 byteSize,
        uint256 epochs,
        uint96 tokenAmount,
        bool includeCurrentEpoch
    ) internal view {
        Chronos chron = chronos;

        uint256 stakeWeightedAverageAsk = askStorage.getStakeWeightedAverageAsk();
        // H7: `SafeCast.toUint96` reverts on overflow instead of silently
        // truncating. A publisher sending `stakeWeightedAverageAsk * byteSize
        // * epochs / 1024` > uint96.max (~79 bn TRAC) MUST revert — silent
        // truncation would make a catastrophically underpaid publish look
        // correctly-paid because `tokenAmount` would match the wrapped cost.
        uint96 expectedTokenAmount;
        if (includeCurrentEpoch) {
            uint256 totalStorageTime = (epochs * 1e18) + (chron.timeUntilNextEpoch() * 1e18) / chron.epochLength();
            expectedTokenAmount = SafeCast.toUint96(
                (stakeWeightedAverageAsk * byteSize * totalStorageTime) / 1024 / 1e18
            );
        } else {
            expectedTokenAmount = SafeCast.toUint96((stakeWeightedAverageAsk * byteSize * epochs) / 1024);
        }

        if (tokenAmount < expectedTokenAmount) {
            revert KnowledgeCollectionLib.InvalidTokenAmount(expectedTokenAmount, tokenAmount);
        }
    }

    function _addTokens(uint96 tokenAmount, address paymaster) internal {
        IERC20 token = tokenContract;

        if (paymasterManager.validPaymasters(paymaster)) {
            IPaymaster(paymaster).coverCost(tokenAmount);
        } else {
            if (token.allowance(msg.sender, address(this)) < tokenAmount) {
                revert TokenLib.TooLowAllowance(
                    address(token),
                    token.allowance(msg.sender, address(this)),
                    tokenAmount
                );
            }

            if (token.balanceOf(msg.sender) < tokenAmount) {
                revert TokenLib.TooLowBalance(address(token), token.balanceOf(msg.sender), tokenAmount);
            }

            if (!token.transferFrom(msg.sender, address(hub.getContractAddress("StakingStorage")), tokenAmount)) {
                revert TokenLib.TransferFailed();
            }
        }
    }

    // ========================================================================
    // V10 Update (works with KnowledgeCollectionStorage, not V9 KnowledgeAssetsStorage)
    // ========================================================================

    /**
     * @notice Update an existing knowledge collection. Only the latest publisher
     *         (the address that pushed the most recent merkle root) may call this.
     *
     * NOTE: This function currently does not charge an update fee. The V9 update
     * fee model (10% + excess-byte cost) is tightly coupled to V9 epoch/reward
     * accounting. A V10-native fee model will be added in a later task.
     *
     * @param id Knowledge collection ID (from publish)
     * @param newMerkleRoot New merkle root for the updated data
     * @param newByteSize Updated byte size (must not exceed original)
     * @param mintAmount Number of new KA tokens to mint (0 if unchanged)
     * @param burnTokenIds Token IDs to burn (empty if unchanged)
     */
    function updateKnowledgeCollection(
        uint256 id,
        bytes32 newMerkleRoot,
        uint88 newByteSize,
        uint256 mintAmount,
        uint256[] calldata burnTokenIds
    ) external {
        KnowledgeCollectionStorage kcs = knowledgeCollectionStorage;

        address latestPublisher = kcs.getLatestMerkleRootPublisher(id);
        require(latestPublisher != address(0), "Knowledge collection does not exist");
        if (latestPublisher != msg.sender) {
            revert KnowledgeAssetsLib.NotBatchPublisher(id, msg.sender);
        }

        (, , , uint88 oldByteSize, , uint40 endEpoch, uint96 existingTokenAmount, bool isImmutable) =
            kcs.getKnowledgeCollectionMetadata(id);

        if (isImmutable) {
            revert KnowledgeCollectionLib.CannotUpdateImmutableKnowledgeCollection(id);
        }

        uint256 currentEpoch = chronos.getCurrentEpoch();
        if (currentEpoch > endEpoch) {
            revert KnowledgeCollectionLib.KnowledgeCollectionExpired(id, currentEpoch, endEpoch);
        }

        uint88 ceiling = originalByteSize[id];
        if (ceiling == 0) {
            // First update for a pre-tracking collection — persist the ceiling
            ceiling = oldByteSize;
            originalByteSize[id] = ceiling;
        }
        require(newByteSize <= ceiling, "Cannot increase byte size without additional payment");
        require(burnTokenIds.length == 0, "Token burning not yet supported in V10 updates");

        kcs.updateKnowledgeCollection(
            msg.sender,
            id,
            "",
            newMerkleRoot,
            mintAmount,
            burnTokenIds,
            newByteSize,
            existingTokenAmount
        );
    }

    // ========================================================================
    // Internal: Token Distribution
    // ========================================================================

    function _distributeTokens(uint96 tokenAmount, uint256 epochs, uint40 currentEpoch) internal {
        require(epochs > 0, "epochs must be > 0");

        uint256 epochLengthInSeconds = chronos.epochLength();
        uint256 timeRemainingInCurrentEpoch = chronos.timeUntilNextEpoch();
        uint256 baseTokensPerFullEpoch = tokenAmount / epochs;
        uint256 currentEpochAllocation = (baseTokensPerFullEpoch * timeRemainingInCurrentEpoch) / epochLengthInSeconds;
        uint256 finalEpochAllocation = baseTokensPerFullEpoch - currentEpochAllocation;
        uint256 numberOfFullEpochs = epochs - 1;
        uint256 totalTokensForFullEpochs = baseTokensPerFullEpoch * numberOfFullEpochs;

        uint256 totalAllocated = currentEpochAllocation + totalTokensForFullEpochs + finalEpochAllocation;
        if (totalAllocated < tokenAmount) {
            finalEpochAllocation += tokenAmount - totalAllocated;
        }

        if (currentEpochAllocation > 0) {
            epochStorage.addTokensToEpochRange(1, currentEpoch, currentEpoch, uint96(currentEpochAllocation));
        }

        if (numberOfFullEpochs > 0 && totalTokensForFullEpochs > 0) {
            epochStorage.addTokensToEpochRange(
                1,
                currentEpoch + 1,
                currentEpoch + uint40(numberOfFullEpochs),
                uint96(totalTokensForFullEpochs)
            );
        }

        if (finalEpochAllocation > 0) {
            epochStorage.addTokensToEpochRange(
                1,
                currentEpoch + uint40(epochs),
                currentEpoch + uint40(epochs),
                uint96(finalEpochAllocation)
            );
        }
    }
}
