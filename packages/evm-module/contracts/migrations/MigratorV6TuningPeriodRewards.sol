// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import {StakingStorage} from "../storage/StakingStorage.sol";
import {ShardingTableStorage} from "../storage/ShardingTableStorage.sol";
import {ParametersStorage} from "../storage/ParametersStorage.sol";
import {Ask} from "../Ask.sol";
import {ShardingTable} from "../ShardingTable.sol";
import {DelegatorsInfo} from "../storage/DelegatorsInfo.sol";
import {ContractStatus} from "../abstract/ContractStatus.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";
import {Chronos} from "../storage/Chronos.sol";
import {Staking} from "../Staking.sol";
import {HubLib} from "../libraries/HubLib.sol";
import {ICustodian} from "../interfaces/ICustodian.sol";
import {ProfileStorage} from "../storage/ProfileStorage.sol";
import {ProfileLib} from "../libraries/ProfileLib.sol";

contract MigratorV6TuningPeriodRewards is INamed, IVersioned, ContractStatus {
    string private constant _NAME = "MigratorV6TuningPeriodRewards";
    string private constant _VERSION = "1.0.0";

    mapping(uint72 => mapping(address => uint96)) public delegatorRewardAmount;
    mapping(uint72 => mapping(address => bool)) public claimedDelegatorReward;

    mapping(uint72 => uint96) public operatorRewardAmount;
    mapping(uint72 => bool) public claimedOperatorReward;

    StakingStorage public stakingStorage;
    ShardingTableStorage public shardingTableStorage;
    ShardingTable public shardingTable;
    ParametersStorage public parametersStorage;
    Ask public askContract;
    DelegatorsInfo public delegatorsInfo;
    Chronos public chronos;
    Staking public staking;
    ProfileStorage public profileStorage;

    // @dev Only transactions by HubController owner or one of the owners of the MultiSig Wallet
    modifier onlyOwnerOrMultiSigOwner() {
        _checkOwnerOrMultiSigOwner();
        _;
    }

    modifier profileExists(uint72 identityId) {
        _checkProfileExists(identityId);
        _;
    }

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) ContractStatus(hubAddress) {}

    function initialize() external onlyHub {
        stakingStorage = StakingStorage(hub.getContractAddress("StakingStorage"));
        shardingTableStorage = ShardingTableStorage(hub.getContractAddress("ShardingTableStorage"));
        shardingTable = ShardingTable(hub.getContractAddress("ShardingTable"));
        parametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        askContract = Ask(hub.getContractAddress("Ask"));
        delegatorsInfo = DelegatorsInfo(hub.getContractAddress("DelegatorsInfo"));
        chronos = Chronos(hub.getContractAddress("Chronos"));
        staking = Staking(hub.getContractAddress("Staking"));
        profileStorage = ProfileStorage(hub.getContractAddress("ProfileStorage"));
    }

    function name() external pure override returns (string memory) {
        return _NAME;
    }

    function version() external pure override returns (string memory) {
        return _VERSION;
    }

    event DelegatorRewardAmountSet(uint72 indexed identityId, address indexed delegator, uint96 amount);
    event OperatorRewardAmountSet(uint72 indexed identityId, uint96 amount);

    function setDelegatorRewardAmount(
        uint72 identityId,
        address delegator,
        uint96 amount
    ) external onlyOwnerOrMultiSigOwner profileExists(identityId) {
        require(amount > 0, "No reward");
        delegatorRewardAmount[identityId][delegator] = amount;

        emit DelegatorRewardAmountSet(identityId, delegator, amount);
    }

    function setOperatorRewardAmount(
        uint72 identityId,
        uint96 amount
    ) external onlyOwnerOrMultiSigOwner profileExists(identityId) {
        require(amount > 0, "No reward");
        operatorRewardAmount[identityId] = amount;

        emit OperatorRewardAmountSet(identityId, amount);
    }

    /**
     * @notice Claims the pre-calculated reward for the caller and immediately
     *         restakes it for the given node.
     * @param identityId The node identifier the caller is delegating to.
     * @param delegator The delegator address.
     */
    function migrateDelegatorReward(uint72 identityId, address delegator) external profileExists(identityId) {
        require(!claimedDelegatorReward[identityId][delegator], "Already claimed delegator reward for this node");

        uint96 amount = delegatorRewardAmount[identityId][delegator];
        require(amount > 0, "No reward");

        // Mark reward as processed - avoid reentrancy
        claimedDelegatorReward[identityId][delegator] = true;

        // Validate epoch claims for V8 rewards
        staking.validateDelegatorEpochClaims(identityId, delegator);

        bytes32 delegatorKey = keccak256(abi.encodePacked(delegator));

        // Settle pending score changes in v8 system
        staking.prepareForStakeChange(chronos.getCurrentEpoch(), identityId, delegatorKey);

        uint96 currentDelegatorStakeBase = stakingStorage.getDelegatorStakeBase(identityId, delegatorKey);
        uint96 newDelegatorStakeBase = currentDelegatorStakeBase + amount;

        uint96 totalNodeStakeBefore = stakingStorage.getNodeStake(identityId);
        uint96 totalNodeStakeAfter = totalNodeStakeBefore + amount;

        // Update staking balances
        stakingStorage.setDelegatorStakeBase(identityId, delegatorKey, newDelegatorStakeBase);
        stakingStorage.setNodeStake(identityId, totalNodeStakeAfter);
        stakingStorage.increaseTotalStake(amount);

        _addNodeToShardingTable(identityId, totalNodeStakeAfter);
        askContract.recalculateActiveSet();

        _manageDelegatorStatus(identityId, delegator);
    }

    /**
     * @notice Transfers the operator reward to the operator balance in staking storage.
     * @param identityId The node identifier the caller is delegating to.
     */
    function migrateOperatorReward(uint72 identityId) external profileExists(identityId) {
        require(!claimedOperatorReward[identityId], "Already claimed operator reward for this node");

        uint96 amount = operatorRewardAmount[identityId];
        require(amount > 0, "No reward");

        claimedOperatorReward[identityId] = true;

        stakingStorage.increaseOperatorFeeBalance(identityId, amount);
    }

    function _manageDelegatorStatus(uint72 identityId, address delegator) internal {
        if (!delegatorsInfo.isNodeDelegator(identityId, delegator)) {
            delegatorsInfo.addDelegator(identityId, delegator);
        }
        uint256 lastStakeHeldEpoch = delegatorsInfo.getLastStakeHeldEpoch(identityId, delegator);
        if (lastStakeHeldEpoch > 0) {
            delegatorsInfo.setLastStakeHeldEpoch(identityId, delegator, 0);
        }
    }

    function _addNodeToShardingTable(uint72 identityId, uint96 totalNodeStakeAfter) internal {
        if (!shardingTableStorage.nodeExists(identityId)) {
            if (totalNodeStakeAfter >= parametersStorage.minimumStake()) {
                shardingTable.insertNode(identityId);
            }
        }
    }

    function _isMultiSigOwner(address multiSigAddress) internal view returns (bool) {
        try ICustodian(multiSigAddress).getOwners() returns (address[] memory multiSigOwners) {
            for (uint256 i = 0; i < multiSigOwners.length; i++) {
                if (msg.sender == multiSigOwners[i]) {
                    return true;
                }
            } // solhint-disable-next-line no-empty-blocks
        } catch {}

        return false;
    }

    function _checkOwnerOrMultiSigOwner() internal view virtual {
        address hubOwner = hub.owner();
        if (msg.sender != hubOwner && !_isMultiSigOwner(hubOwner)) {
            revert HubLib.UnauthorizedAccess("Only Hub Owner or Multisig Owner");
        }
    }

    /**
     * @dev Internal function to validate that a node profile exists
     * Used by modifiers and functions to ensure operations target valid nodes
     * @param identityId Node identity to check existence for
     */
    function _checkProfileExists(uint72 identityId) internal view virtual {
        if (!profileStorage.profileExists(identityId)) {
            revert ProfileLib.ProfileDoesntExist(identityId);
        }
    }
}
