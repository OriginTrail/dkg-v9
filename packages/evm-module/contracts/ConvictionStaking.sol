// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {INamed} from "./interfaces/INamed.sol";
import {IVersioned} from "./interfaces/IVersioned.sol";
import {IInitializable} from "./interfaces/IInitializable.sol";
import {ContractStatus} from "./abstract/ContractStatus.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StakingStorage} from "./storage/StakingStorage.sol";
import {ConvictionStakeStorage} from "./storage/ConvictionStakeStorage.sol";
import {RandomSamplingStorage} from "./storage/RandomSamplingStorage.sol";
import {DelegatorsInfo} from "./storage/DelegatorsInfo.sol";
import {ParametersStorage} from "./storage/ParametersStorage.sol";
import {ProfileStorage} from "./storage/ProfileStorage.sol";
import {IdentityStorage} from "./storage/IdentityStorage.sol";
import {ShardingTable} from "./ShardingTable.sol";
import {ShardingTableStorage} from "./storage/ShardingTableStorage.sol";
import {Ask} from "./Ask.sol";
import {Chronos} from "./storage/Chronos.sol";
import {ProfileLib} from "./libraries/ProfileLib.sol";
import {ShardingTableLib} from "./libraries/ShardingTableLib.sol";

contract ConvictionStaking is INamed, IVersioned, ContractStatus, IInitializable, ERC721Enumerable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string private constant _NAME = "ConvictionStaking";
    string private constant _VERSION = "1.0.0";
    uint256 private constant SCALE18 = 1e18;

    struct Position {
        uint96 principal;
        uint8 lockTier; // {0, 1, 3, 6, 12}
        uint40 startEpoch;
        uint72 nodeId;
        uint96 claimableRewards;
        uint40 lastClaimedEpoch;
        uint256 lastSettledScorePerStake;
        uint96 withdrawalAmount;
        uint256 withdrawalTimestamp;
    }

    uint256 private _nextTokenId;
    mapping(uint256 => Position) public positions;

    IERC20 public tokenContract;
    StakingStorage public stakingStorage;
    ConvictionStakeStorage public convictionStakeStorage;
    RandomSamplingStorage public randomSamplingStorage;
    DelegatorsInfo public delegatorsInfo;
    ParametersStorage public parametersStorage;
    ProfileStorage public profileStorage;
    IdentityStorage public identityStorage;
    ShardingTable public shardingTableContract;
    ShardingTableStorage public shardingTableStorage;
    Ask public askContract;
    Chronos public chronos;

    event Staked(
        uint256 indexed tokenId,
        address indexed staker,
        uint72 indexed nodeId,
        uint96 amount,
        uint8 lockTier
    );

    error InvalidLockTier(uint8 tier);
    error ZeroStakeAmount();
    error MaximumStakeExceeded(uint96 maximum);

    constructor(address hubAddress) ContractStatus(hubAddress) ERC721("ConvictionStaking", "CSTAKE") {}

    function initialize() external onlyHub {
        tokenContract = IERC20(hub.getContractAddress("Token"));
        stakingStorage = StakingStorage(hub.getContractAddress("StakingStorage"));
        convictionStakeStorage = ConvictionStakeStorage(hub.getContractAddress("ConvictionStakeStorage"));
        randomSamplingStorage = RandomSamplingStorage(hub.getContractAddress("RandomSamplingStorage"));
        delegatorsInfo = DelegatorsInfo(hub.getContractAddress("DelegatorsInfo"));
        parametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        profileStorage = ProfileStorage(hub.getContractAddress("ProfileStorage"));
        identityStorage = IdentityStorage(hub.getContractAddress("IdentityStorage"));
        shardingTableContract = ShardingTable(hub.getContractAddress("ShardingTable"));
        shardingTableStorage = ShardingTableStorage(hub.getContractAddress("ShardingTableStorage"));
        askContract = Ask(hub.getContractAddress("Ask"));
        chronos = Chronos(hub.getContractAddress("Chronos"));
    }

    function name() public pure override(INamed, ERC721) returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override(ERC721Enumerable) returns (address) {
        address from = _ownerOf(tokenId);
        // Soulbound: allow mint (from == 0) and burn (to == 0), block transfers
        if (from != address(0) && to != address(0)) {
            revert("ConvictionStaking: position is soulbound");
        }
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    /**
     * @notice Stake TRAC to a node and receive an NFT position.
     * @param nodeId Identity ID of the node to delegate to
     * @param amount Amount of TRAC to stake
     * @param lockTier Lock tier (only 0 supported in this version)
     */
    function stake(uint72 nodeId, uint96 amount, uint8 lockTier) external nonReentrant {
        if (amount == 0) revert ZeroStakeAmount();
        if (lockTier != 0) revert InvalidLockTier(lockTier);
        if (!profileStorage.profileExists(nodeId)) revert ProfileLib.ProfileDoesntExist(nodeId);

        // Check maximum stake on raw principal
        uint96 currentNodeStake = stakingStorage.getNodeStake(nodeId);
        uint96 maximumStake = parametersStorage.maximumStake();
        if (currentNodeStake + amount > maximumStake) {
            revert MaximumStakeExceeded(maximumStake);
        }

        // Validate delegator epoch claims and settle pending score before changing stake
        bytes32 delegatorKey = _getDelegatorKey(msg.sender);
        uint40 currentEpoch = uint40(chronos.getCurrentEpoch());
        _validateDelegatorEpochClaims(nodeId, msg.sender, delegatorKey, currentEpoch);
        _prepareForStakeChange(currentEpoch, nodeId, delegatorKey);

        // Mint NFT
        uint256 tokenId = _nextTokenId++;
        _mint(msg.sender, tokenId);

        // Store position
        positions[tokenId] = Position({
            principal: amount,
            lockTier: lockTier,
            startEpoch: currentEpoch,
            nodeId: nodeId,
            claimableRewards: 0,
            lastClaimedEpoch: currentEpoch,
            lastSettledScorePerStake: 0,
            withdrawalAmount: 0,
            withdrawalTimestamp: 0
        });

        // Update per-delegator stakeBase in StakingStorage (address-keyed for reward claim compatibility)
        uint96 existingStakeBase = stakingStorage.getDelegatorStakeBase(nodeId, delegatorKey);
        stakingStorage.setDelegatorStakeBase(nodeId, delegatorKey, existingStakeBase + amount);

        // Update raw node-level stake in StakingStorage
        uint96 newNodeStake = currentNodeStake + amount;
        stakingStorage.setNodeStake(nodeId, newNodeStake);
        stakingStorage.increaseTotalStake(amount);

        // Update effective stake in ConvictionStakeStorage (1x for tier 0)
        convictionStakeStorage.increaseEffectiveNodeStake(nodeId, uint256(amount));
        convictionStakeStorage.increaseEffectiveTotalStake(uint256(amount));

        // Register delegator in DelegatorsInfo (for reward claiming)
        _manageDelegatorStatus(nodeId, msg.sender);

        // Add to sharding table if stake meets minimum and table has capacity
        _addNodeToShardingTable(nodeId, newNodeStake);

        // Recalculate active set
        askContract.recalculateActiveSet();

        // Transfer TRAC from staker to StakingStorage (SafeERC20)
        tokenContract.safeTransferFrom(msg.sender, address(stakingStorage), amount);

        emit Staked(tokenId, msg.sender, nodeId, amount, lockTier);
    }

    /**
     * @notice Get full position data for a token.
     * @param tokenId The NFT token ID
     * @return position The position struct
     */
    function getPosition(uint256 tokenId) external view returns (Position memory) {
        _requireOwned(tokenId);
        return positions[tokenId];
    }

    // ========================================================================
    // Internal: Delegator management
    // ========================================================================

    function _getDelegatorKey(address delegator) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(delegator));
    }

    /**
     * @dev Registers delegator in DelegatorsInfo if not already present.
     *      Resets lastStakeHeldEpoch when delegator becomes active again.
     */
    function _manageDelegatorStatus(uint72 identityId, address delegator) internal {
        if (!delegatorsInfo.isNodeDelegator(identityId, delegator)) {
            delegatorsInfo.addDelegator(identityId, delegator);
        }
        uint256 lastStakeHeld = delegatorsInfo.getLastStakeHeldEpoch(identityId, delegator);
        if (lastStakeHeld > 0) {
            delegatorsInfo.setLastStakeHeldEpoch(identityId, delegator, 0);
        }
    }

    /**
     * @dev Validates that all required epoch rewards have been claimed before stake changes.
     *      For first-time delegators, sets initial claim tracking state.
     */
    function _validateDelegatorEpochClaims(
        uint72 identityId,
        address delegator,
        bytes32 delegatorKey,
        uint256 currentEpoch
    ) internal {
        uint256 previousEpoch = currentEpoch - 1;

        if (delegatorsInfo.hasEverDelegatedToNode(identityId, delegator)) {
            if (stakingStorage.getDelegatorStakeBase(identityId, delegatorKey) == 0) {
                uint256 lastStakeHeld = delegatorsInfo.getLastStakeHeldEpoch(identityId, delegator);
                if (lastStakeHeld > 0 && lastStakeHeld < currentEpoch) {
                    revert("Must claim rewards up to the lastStakeHeldEpoch before changing stake");
                }
                delegatorsInfo.setLastClaimedEpoch(identityId, delegator, previousEpoch);
            }
        } else {
            delegatorsInfo.setHasEverDelegatedToNode(identityId, delegator, true);
            delegatorsInfo.setLastClaimedEpoch(identityId, delegator, previousEpoch);
        }

        uint256 lastClaimed = delegatorsInfo.getLastClaimedEpoch(identityId, delegator);
        if (lastClaimed == previousEpoch) return;

        if (lastClaimed < previousEpoch - 1) {
            revert("Must claim all previous epoch rewards before changing stake");
        }

        // Exactly one unclaimed epoch (previousEpoch) — check if there are actually rewards
        uint256 delegatorScore = randomSamplingStorage.getEpochNodeDelegatorScore(
            previousEpoch,
            identityId,
            delegatorKey
        );
        uint256 nodeScorePerStake = randomSamplingStorage.getNodeEpochScorePerStake(previousEpoch, identityId);
        uint256 delegatorLastSettled = randomSamplingStorage.getDelegatorLastSettledNodeEpochScorePerStake(
            previousEpoch,
            identityId,
            delegatorKey
        );

        if (delegatorScore == 0 && nodeScorePerStake == delegatorLastSettled) {
            delegatorsInfo.setLastClaimedEpoch(identityId, delegator, previousEpoch);
            return;
        }

        revert("Must claim the previous epoch rewards before changing stake");
    }

    /**
     * @dev Settles pending scorePerStake changes for a delegator before any stake mutation.
     *      Calculates and records newly earned score since the last settlement.
     */
    function _prepareForStakeChange(
        uint256 epoch,
        uint72 identityId,
        bytes32 delegatorKey
    ) internal returns (uint256 delegatorEpochScore) {
        uint256 nodeScorePerStake36 = randomSamplingStorage.getNodeEpochScorePerStake(epoch, identityId);
        uint256 currentDelegatorScore18 = randomSamplingStorage.getEpochNodeDelegatorScore(
            epoch,
            identityId,
            delegatorKey
        );
        uint256 delegatorLastSettled36 = randomSamplingStorage.getDelegatorLastSettledNodeEpochScorePerStake(
            epoch,
            identityId,
            delegatorKey
        );

        if (nodeScorePerStake36 == delegatorLastSettled36) {
            return currentDelegatorScore18;
        }

        uint96 stakeBase = stakingStorage.getDelegatorStakeBase(identityId, delegatorKey);
        if (stakeBase == 0) {
            randomSamplingStorage.setDelegatorLastSettledNodeEpochScorePerStake(
                epoch,
                identityId,
                delegatorKey,
                nodeScorePerStake36
            );
            return currentDelegatorScore18;
        }

        uint256 scorePerStakeDiff36 = nodeScorePerStake36 - delegatorLastSettled36;
        uint256 scoreEarned18 = (uint256(stakeBase) * scorePerStakeDiff36) / SCALE18;

        if (scoreEarned18 > 0) {
            randomSamplingStorage.addToEpochNodeDelegatorScore(epoch, identityId, delegatorKey, scoreEarned18);
        }

        randomSamplingStorage.setDelegatorLastSettledNodeEpochScorePerStake(
            epoch,
            identityId,
            delegatorKey,
            nodeScorePerStake36
        );

        return currentDelegatorScore18 + scoreEarned18;
    }

    // ========================================================================
    // Internal: Sharding table admission
    // ========================================================================

    /**
     * @dev Adds node to sharding table only when stake meets minimum and table has capacity.
     *      Matches the admission rules in Staking._addNodeToShardingTable.
     */
    function _addNodeToShardingTable(uint72 identityId, uint96 newStake) internal {
        if (!shardingTableStorage.nodeExists(identityId) && newStake >= parametersStorage.minimumStake()) {
            if (shardingTableStorage.nodesCount() >= parametersStorage.shardingTableSizeLimit()) {
                revert ShardingTableLib.ShardingTableIsFull();
            }
            shardingTableContract.insertNode(identityId);
        }
    }
}
