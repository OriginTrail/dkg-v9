// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AskStorage} from "./storage/AskStorage.sol";
import {EpochStorage} from "./storage/EpochStorage.sol";
import {PaymasterManager} from "./storage/PaymasterManager.sol";
import {Chronos} from "./storage/Chronos.sol";
import {KnowledgeAssetsStorage} from "./storage/KnowledgeAssetsStorage.sol";
import {ShardingTableStorage} from "./storage/ShardingTableStorage.sol";
import {IdentityStorage} from "./storage/IdentityStorage.sol";
import {ParametersStorage} from "./storage/ParametersStorage.sol";
import {ParanetKnowledgeCollectionsRegistry} from "./storage/paranets/ParanetKnowledgeCollectionsRegistry.sol";
import {ParanetKnowledgeMinersRegistry} from "./storage/paranets/ParanetKnowledgeMinersRegistry.sol";
import {ParanetsRegistry} from "./storage/paranets/ParanetsRegistry.sol";
import {KnowledgeAssetsLib} from "./libraries/KnowledgeAssetsLib.sol";
import {TokenLib} from "./libraries/TokenLib.sol";
import {IdentityLib} from "./libraries/IdentityLib.sol";
import {INamed} from "./interfaces/INamed.sol";
import {IPaymaster} from "./interfaces/IPaymaster.sol";
import {IVersioned} from "./interfaces/IVersioned.sol";
import {IInitializable} from "./interfaces/IInitializable.sol";
import {ContractStatus} from "./abstract/ContractStatus.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "solady/src/utils/ECDSA.sol";

/**
 * @title KnowledgeAssets
 * @notice V9 logic contract for publishing Knowledge Assets with pre-minted UALs.
 *
 * Replaces V8's KnowledgeCollection.sol in the Hub. Uses the new
 * KnowledgeAssetsStorage (clean V9 storage) instead of the legacy
 * KnowledgeCollectionStorage.
 *
 * UAL format: did:dkg:{chainId}/{publisherIdentityId}/{localKAId}
 */
contract KnowledgeAssets is INamed, IVersioned, ContractStatus, IInitializable {
    string private constant _NAME = "KnowledgeAssets";
    string private constant _VERSION = "1.0.0";

    AskStorage public askStorage;
    EpochStorage public epochStorage;
    PaymasterManager public paymasterManager;
    ParanetKnowledgeCollectionsRegistry public paranetKnowledgeCollectionsRegistry;
    ParanetKnowledgeMinersRegistry public paranetKnowledgeMinersRegistry;
    ParanetsRegistry public paranetsRegistry;
    KnowledgeAssetsStorage public knowledgeAssetsStorage;
    Chronos public chronos;
    ShardingTableStorage public shardingTableStorage;
    IERC20 public tokenContract;
    ParametersStorage public parametersStorage;
    IdentityStorage public identityStorage;

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
        knowledgeAssetsStorage = KnowledgeAssetsStorage(
            hub.getAssetStorageAddress("KnowledgeAssetsStorage")
        );
        chronos = Chronos(hub.getContractAddress("Chronos"));
        shardingTableStorage = ShardingTableStorage(hub.getContractAddress("ShardingTableStorage"));
        tokenContract = IERC20(hub.getContractAddress("Token"));
        parametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        identityStorage = IdentityStorage(hub.getContractAddress("IdentityStorage"));
    }

    function name() public pure virtual returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual returns (string memory) {
        return _VERSION;
    }

    // ========================================================================
    // UAL Range Reservation
    // ========================================================================

    /**
     * @notice Reserve a block of KA IDs for a publisher. Gas cost only, no TRAC.
     * @param identityId The publisher's on-chain identity ID
     * @param count Number of IDs to reserve
     * @return startId First reserved ID
     * @return endId Last reserved ID (inclusive)
     */
    function reserveUALRange(
        uint72 identityId,
        uint32 count
    ) external returns (uint64 startId, uint64 endId) {
        _requireOperationalKey(identityId, msg.sender);
        return knowledgeAssetsStorage.reserveUALRange(identityId, count);
    }

    // ========================================================================
    // Batch Minting
    // ========================================================================

    /**
     * @notice Batch-mint Knowledge Assets from a publisher's reserved range.
     *
     * @param publisherNodeIdentityId Publisher's identity on the node that stores data
     * @param merkleRoot KC-level merkle root covering all KAs in this batch
     * @param startKAId First KA ID (from publisher's reserved range)
     * @param endKAId Last KA ID inclusive (from publisher's reserved range)
     * @param publicByteSize Size of public triples in bytes
     * @param epochs Storage duration in epochs (1 epoch = 30 days)
     * @param tokenAmount TRAC payment for storage
     * @param paymaster Optional paymaster address (zero = direct TRAC transfer)
     * @param publisherNodeR Publisher node signature R
     * @param publisherNodeVS Publisher node signature VS
     * @param identityIds Receiving node identity IDs (for signature verification)
     * @param r Receiving node signature R values
     * @param vs Receiving node signature VS values
     * @return batchId The on-chain batch ID for this publish operation
     */
    function batchMintKnowledgeAssets(
        uint72 publisherNodeIdentityId,
        bytes32 merkleRoot,
        uint64 startKAId,
        uint64 endKAId,
        uint64 publicByteSize,
        uint40 epochs,
        uint96 tokenAmount,
        address paymaster,
        bytes32 publisherNodeR,
        bytes32 publisherNodeVS,
        uint72[] calldata identityIds,
        bytes32[] calldata r,
        bytes32[] calldata vs
    ) external returns (uint256 batchId) {
        if (startKAId > endKAId) {
            revert KnowledgeAssetsLib.InvalidKARange(startKAId, endKAId);
        }

        // Verify publisher signature: signs H(identityId || merkleRoot)
        _verifySignature(
            publisherNodeIdentityId,
            ECDSA.toEthSignedMessageHash(
                keccak256(abi.encodePacked(publisherNodeIdentityId, merkleRoot))
            ),
            publisherNodeR,
            publisherNodeVS
        );

        // Verify receiving node signatures: sign H(merkleRoot)
        _verifySignatures(
            identityIds,
            ECDSA.toEthSignedMessageHash(merkleRoot),
            r,
            vs
        );

        KnowledgeAssetsStorage kas = knowledgeAssetsStorage;

        // Validate KA IDs are in the publisher's reserved range and not already used
        for (uint64 id = startKAId; id <= endKAId; id++) {
            if (kas.isKAIdUsed(publisherNodeIdentityId, id)) {
                revert KnowledgeAssetsLib.KAIdAlreadyUsed(publisherNodeIdentityId, id);
            }
        }

        uint32 kaCount = uint32(endKAId - startKAId + 1);
        uint40 currentEpoch = uint40(chronos.getCurrentEpoch());

        // Validate token amount covers storage cost
        // cost = stakeWeightedAverageAsk × publicByteSize × epochs / 1024
        _validateTokenAmount(publicByteSize, epochs, tokenAmount);

        // Create the batch in storage
        batchId = kas.createKnowledgeBatch(
            publisherNodeIdentityId,
            msg.sender,
            merkleRoot,
            publicByteSize,
            kaCount,
            startKAId,
            endKAId,
            currentEpoch,
            currentEpoch + epochs,
            tokenAmount,
            false // not permanent
        );

        // Distribute tokens across epochs
        _distributeTokens(tokenAmount, epochs, currentEpoch);

        // Record knowledge value for the publisher node
        epochStorage.addEpochProducedKnowledgeValue(
            publisherNodeIdentityId,
            currentEpoch,
            tokenAmount
        );

        // Transfer TRAC payment
        _addTokens(tokenAmount, paymaster);
    }

    // ========================================================================
    // Knowledge Updates
    // ========================================================================

    /**
     * @notice Update the merkle root and byte size of an existing batch.
     * Only callable by the original publisher.
     *
     * Pricing: 10% of original cost if new size <= original, else full rate on excess.
     */
    function updateKnowledgeAssets(
        uint256 batchId,
        bytes32 newMerkleRoot,
        uint64 newPublicByteSize
    ) external {
        KnowledgeAssetsStorage kas = knowledgeAssetsStorage;
        KnowledgeAssetsLib.KnowledgeBatch memory batch = kas.getBatch(batchId);

        if (batch.publisherAddress == address(0)) {
            revert KnowledgeAssetsLib.BatchNotFound(batchId);
        }
        if (batch.publisherAddress != msg.sender) {
            revert KnowledgeAssetsLib.NotBatchPublisher(batchId, msg.sender);
        }

        uint256 currentEpoch = chronos.getCurrentEpoch();
        if (currentEpoch > batch.endEpoch) {
            revert KnowledgeAssetsLib.BatchExpired(batchId, currentEpoch, batch.endEpoch);
        }

        // Calculate update cost
        uint96 updateCost;
        uint256 stakeWeightedAverageAsk = askStorage.getStakeWeightedAverageAsk();
        uint256 remainingEpochs = batch.endEpoch - uint40(currentEpoch);

        if (newPublicByteSize <= batch.publicByteSize) {
            // Same or smaller: 10% fee on original cost
            uint96 originalCost = uint96(
                (stakeWeightedAverageAsk * batch.publicByteSize * (batch.endEpoch - batch.startEpoch)) / 1024
            );
            updateCost = originalCost / 10;
        } else {
            // Larger: 10% base + full rate on excess bytes for remaining epochs
            uint96 originalCost = uint96(
                (stakeWeightedAverageAsk * batch.publicByteSize * (batch.endEpoch - batch.startEpoch)) / 1024
            );
            uint64 excessBytes = newPublicByteSize - batch.publicByteSize;
            uint96 excessCost = uint96(
                (stakeWeightedAverageAsk * excessBytes * remainingEpochs) / 1024
            );
            updateCost = originalCost / 10 + excessCost;
        }

        kas.updateKnowledgeBatch(batchId, newMerkleRoot, newPublicByteSize, updateCost);

        // Distribute additional tokens across remaining epochs
        if (updateCost > 0 && remainingEpochs > 0) {
            epochStorage.addTokensToEpochRange(
                1,
                uint40(currentEpoch),
                batch.endEpoch,
                updateCost
            );
        }

        _addTokens(updateCost, address(0));
    }

    // ========================================================================
    // Storage Extension
    // ========================================================================

    /**
     * @notice Extend the storage duration of a batch.
     */
    function extendStorage(
        uint256 batchId,
        uint40 additionalEpochs,
        uint96 tokenAmount,
        address paymaster
    ) external {
        KnowledgeAssetsStorage kas = knowledgeAssetsStorage;
        KnowledgeAssetsLib.KnowledgeBatch memory batch = kas.getBatch(batchId);

        if (batch.publisherAddress == address(0)) {
            revert KnowledgeAssetsLib.BatchNotFound(batchId);
        }

        uint256 currentEpoch = chronos.getCurrentEpoch();
        if (currentEpoch > batch.endEpoch) {
            revert KnowledgeAssetsLib.BatchExpired(batchId, currentEpoch, batch.endEpoch);
        }

        _validateTokenAmount(batch.publicByteSize, additionalEpochs, tokenAmount);

        kas.extendBatchStorage(batchId, additionalEpochs, tokenAmount);

        epochStorage.addTokensToEpochRange(
            1,
            batch.endEpoch,
            batch.endEpoch + additionalEpochs,
            tokenAmount
        );

        _addTokens(tokenAmount, paymaster);
    }

    // ========================================================================
    // Internal Helpers (forked from V8 KnowledgeCollection.sol)
    // ========================================================================

    function _requireOperationalKey(uint72 identityId, address caller) internal view {
        if (
            !identityStorage.keyHasPurpose(
                identityId,
                keccak256(abi.encodePacked(caller)),
                IdentityLib.OPERATIONAL_KEY
            )
        ) {
            revert KnowledgeAssetsLib.SignerIsNotNodeOperator(identityId, caller);
        }
    }

    function _verifySignatures(
        uint72[] calldata identityIds,
        bytes32 messageHash,
        bytes32[] calldata r,
        bytes32[] calldata vs
    ) internal view {
        if (r.length != identityIds.length || r.length != vs.length) {
            revert KnowledgeAssetsLib.SignaturesSignersMismatch(r.length, vs.length, identityIds.length);
        }

        if (r.length < parametersStorage.minimumRequiredSignatures()) {
            revert KnowledgeAssetsLib.MinSignaturesRequirementNotMet(
                parametersStorage.minimumRequiredSignatures(),
                r.length
            );
        }

        for (uint256 i; i < identityIds.length; i++) {
            _verifySignature(identityIds[i], messageHash, r[i], vs[i]);
        }
    }

    function _verifySignature(
        uint72 identityId,
        bytes32 messageHash,
        bytes32 r,
        bytes32 vs
    ) internal view {
        address signer = ECDSA.tryRecover(messageHash, r, vs);

        if (signer == address(0)) {
            revert KnowledgeAssetsLib.InvalidSignature(identityId, messageHash, r, vs);
        }

        if (
            !identityStorage.keyHasPurpose(
                identityId,
                keccak256(abi.encodePacked(signer)),
                IdentityLib.OPERATIONAL_KEY
            )
        ) {
            revert KnowledgeAssetsLib.SignerIsNotNodeOperator(identityId, signer);
        }
    }

    function _validateTokenAmount(
        uint256 byteSize,
        uint256 epochs,
        uint96 tokenAmount
    ) internal view {
        uint256 stakeWeightedAverageAsk = askStorage.getStakeWeightedAverageAsk();
        uint96 expectedTokenAmount = uint96(
            (stakeWeightedAverageAsk * byteSize * epochs) / 1024
        );

        if (tokenAmount < expectedTokenAmount) {
            revert KnowledgeAssetsLib.InvalidTokenAmount(expectedTokenAmount, tokenAmount);
        }
    }

    function _addTokens(uint96 tokenAmount, address paymaster) internal {
        if (tokenAmount == 0) return;

        IERC20 token = tokenContract;

        if (paymaster != address(0) && paymasterManager.validPaymasters(paymaster)) {
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
                revert TokenLib.TooLowBalance(
                    address(token),
                    token.balanceOf(msg.sender),
                    tokenAmount
                );
            }

            if (!token.transferFrom(msg.sender, hub.getContractAddress("StakingStorage"), tokenAmount)) {
                revert TokenLib.TransferFailed();
            }
        }
    }

    function _distributeTokens(
        uint96 tokenAmount,
        uint256 epochs,
        uint40 currentEpoch
    ) internal {
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
