// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {ShardingTable} from "../ShardingTable.sol";
import {Token} from "../Token.sol";
import {AskStorage} from "../storage/AskStorage.sol";
import {EpochStorage} from "../storage/EpochStorage.sol";
import {IdentityStorage} from "../storage/IdentityStorage.sol";
import {ParametersStorage} from "../storage/ParametersStorage.sol";
import {ProfileStorage} from "../storage/ProfileStorage.sol";
import {StakingStorage} from "../storage/StakingStorage.sol";
import {ContractStatus} from "../abstract/ContractStatus.sol";
import {IdentityLib} from "../libraries/IdentityLib.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IOldHub {
    function getContractAddress(string memory) external view returns (address);
}

interface IOldStakingStorage {
    function transferStake(address, uint96) external;
    function totalStakes(uint72) external view returns (uint96);
    function getWithdrawalRequestAmount(uint72, address) external view returns (uint96);
    function getWithdrawalRequestTimestamp(uint72, address) external view returns (uint256);
}

interface IOldProfileStorage {
    function transferAccumulatedOperatorFee(address, uint96) external;
    function getAccumulatedOperatorFee(uint72) external view returns (uint96);
    function getSharesContractAddress(uint72) external view returns (address);
    function getAccumulatedOperatorFeeWithdrawalAmount(uint72) external view returns (uint96);
    function getAccumulatedOperatorFeeWithdrawalTimestamp(uint72) external view returns (uint256);
    function getNodeId(uint72) external view returns (bytes memory);
    function getAsk(uint72) external view returns (uint96);
}

interface IOldNodeOperatorFeesStorage {
    function getOperatorFeesLength(uint72) external view returns (uint256);
    function getLatestOperatorFeePercentage(uint72) external view returns (uint8);
}

interface IOldServiceAgreementStorage {
    function transferAgreementTokens(address, uint96) external;
}

contract Migrator is ContractStatus {
    error DelegatorsMigrationNotInitiated();
    error DelegatorAlreadyMigrated(uint72 identityId, address delegator);
    error InvalidTotalStake(uint96 expected, uint96 received);

    IOldHub public oldHub;
    IdentityStorage public oldIdentityStorage;
    IOldStakingStorage public oldStakingStorage;
    IOldProfileStorage public oldProfileStorage;
    IOldNodeOperatorFeesStorage public oldNodeOperatorFeesStorage;
    IOldServiceAgreementStorage public oldServiceAgreementStorageV1;
    IOldServiceAgreementStorage public oldServiceAgreementStorageV1U1;

    EpochStorage public epochStorageV6;
    ParametersStorage public newParametersStorage;
    ProfileStorage public newProfileStorage;
    ShardingTable public newShardingTable;
    StakingStorage public newStakingStorage;
    IdentityStorage public newIdentityStorage;
    AskStorage public askStorage;
    Token public token;

    uint72 public oldNodesCount;
    uint72 public migratedNodes;

    uint96 public oldStakingStorageBalance;
    uint96 public oldOperatorFees;
    uint96 public oldTotalUnpaidRewards;

    uint96 public oldTotalStake;
    uint96 public oldMigratedOperatorFees;
    uint96 public migratedStake;

    bool public delegatorsMigrationInitiated;

    mapping(uint72 => uint96) public oldNodeStakes;
    mapping(uint72 => uint96) public migratedStakes;

    mapping(uint72 => bool) public nodeMigrated;
    mapping(uint72 => mapping(address => bool)) public delegatorMigrated;
    mapping(uint72 => bool) public operatorMigrated;

    constructor(address hubAddress, address oldHubAddress) ContractStatus(hubAddress) {
        oldHub = IOldHub(oldHubAddress);
    }

    function initializeOldContracts() external onlyHub {
        oldIdentityStorage = IdentityStorage(oldHub.getContractAddress("IdentityStorage"));
        oldStakingStorage = IOldStakingStorage(oldHub.getContractAddress("StakingStorage"));
        oldProfileStorage = IOldProfileStorage(oldHub.getContractAddress("ProfileStorage"));
        oldNodeOperatorFeesStorage = IOldNodeOperatorFeesStorage(oldHub.getContractAddress("NodeOperatorFeesStorage"));
        oldServiceAgreementStorageV1 = IOldServiceAgreementStorage(
            oldHub.getContractAddress("ServiceAgreementStorageV1")
        );
        oldServiceAgreementStorageV1U1 = IOldServiceAgreementStorage(
            oldHub.getContractAddress("ServiceAgreementStorageV1U1")
        );
    }

    function initializeNewContracts() external onlyHub {
        epochStorageV6 = EpochStorage(hub.getContractAddress("EpochStorageV6"));
        newParametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        newProfileStorage = ProfileStorage(hub.getContractAddress("ProfileStorage"));
        newShardingTable = ShardingTable(hub.getContractAddress("ShardingTable"));
        newStakingStorage = StakingStorage(hub.getContractAddress("StakingStorage"));
        newIdentityStorage = IdentityStorage(hub.getContractAddress("IdentityStorage"));
        askStorage = AskStorage(hub.getContractAddress("AskStorage"));
        token = Token(hub.getContractAddress("Token"));
    }

    function transferStake() external onlyHubOwner {
        oldStakingStorageBalance = uint96(token.balanceOf(address(oldStakingStorage)));
        if (oldStakingStorageBalance > 0) {
            oldStakingStorage.transferStake(address(newStakingStorage), oldStakingStorageBalance);
        }
    }

    function transferOperatorFees() external onlyHubOwner {
        oldOperatorFees = uint96(token.balanceOf(address(oldProfileStorage)));
        if (oldOperatorFees > 0) {
            oldProfileStorage.transferAccumulatedOperatorFee(address(newStakingStorage), oldOperatorFees);
        }
    }

    function transferUnpaidRewards(uint256 startEpoch, uint256 endEpoch) external onlyHubOwner {
        uint96 saV1Balance = uint96(token.balanceOf(address(oldServiceAgreementStorageV1)));
        uint96 saV1U1Balance = uint96(token.balanceOf(address(oldServiceAgreementStorageV1U1)));

        oldTotalUnpaidRewards += saV1Balance;
        oldTotalUnpaidRewards += saV1U1Balance;

        if (oldTotalUnpaidRewards > 0) {
            epochStorageV6.addTokensToEpochRange(1, startEpoch, endEpoch, oldTotalUnpaidRewards);
        }

        if (saV1Balance > 0) {
            oldServiceAgreementStorageV1.transferAgreementTokens(address(newStakingStorage), saV1Balance);
        }
        if (saV1U1Balance > 0) {
            oldServiceAgreementStorageV1U1.transferAgreementTokens(address(newStakingStorage), saV1U1Balance);
        }
    }

    function initiateDelegatorsMigration() external onlyHubOwner {
        delegatorsMigrationInitiated = true;
    }

    function migrateGlobalData(uint96 stake) external onlyHubOwner {
        newIdentityStorage.setLastIdentityId(oldNodesCount);
        newStakingStorage.setTotalStake(stake);
    }

    function migrateNodeData(uint72 identityId) external onlyHubOwner {
        bytes32[] memory adminKeys = oldIdentityStorage.getKeysByPurpose(identityId, IdentityLib.ADMIN_KEY);
        for (uint256 i; i < adminKeys.length; i++) {
            (uint256 purpose, uint256 keyType, bytes32 key) = oldIdentityStorage.getKey(identityId, adminKeys[i]);
            newIdentityStorage.addKey(identityId, key, purpose, keyType);
        }

        bytes32[] memory operationalKeys = oldIdentityStorage.getKeysByPurpose(identityId, IdentityLib.OPERATIONAL_KEY);
        for (uint256 i; i < operationalKeys.length; i++) {
            (uint256 purpose, uint256 keyType, bytes32 key) = oldIdentityStorage.getKey(identityId, operationalKeys[i]);
            newIdentityStorage.addKey(identityId, key, purpose, keyType);
            newIdentityStorage.setOperationalKeyIdentityId(key, identityId);
        }

        uint96 nodeStake = oldStakingStorage.totalStakes(identityId);

        newStakingStorage.setNodeStake(identityId, nodeStake);
        newStakingStorage.increaseTotalStake(nodeStake);

        oldNodeStakes[identityId] = nodeStake;
        oldNodesCount += 1;
        oldTotalStake += nodeStake;

        IERC20Metadata shares = IERC20Metadata(oldProfileStorage.getSharesContractAddress(identityId));

        string memory nodeName = shares.name();
        bytes memory nodeId = oldProfileStorage.getNodeId(identityId);
        uint96 initialAsk = oldProfileStorage.getAsk(identityId) / 3;

        uint16 initialOperatorFee;
        uint256 operatorFeesArrayLength = oldNodeOperatorFeesStorage.getOperatorFeesLength(identityId);
        if (operatorFeesArrayLength == 0) {
            initialOperatorFee = 0;
        } else {
            initialOperatorFee = uint16(oldNodeOperatorFeesStorage.getLatestOperatorFeePercentage(identityId)) * 100;
        }

        newProfileStorage.createProfile(identityId, nodeName, nodeId, initialOperatorFee);
        newProfileStorage.setAsk(identityId, initialAsk);

        if (nodeStake >= newParametersStorage.minimumStake()) {
            newShardingTable.insertNode(identityId);
        }
    }

    function updateAskStorage(uint256 weightedAskSum, uint96 totalStake) external onlyHubOwner {
        AskStorage ass = askStorage;

        ass.setPrevWeightedActiveAskSum(weightedAskSum);
        ass.setWeightedActiveAskSum(weightedAskSum);

        ass.setPrevTotalActiveStake(totalStake);
        ass.setTotalActiveStake(totalStake);
    }

    function migrateDelegatorData(uint72 identityId) external {
        if (!delegatorsMigrationInitiated) {
            revert DelegatorsMigrationNotInitiated();
        }
        if (delegatorMigrated[identityId][msg.sender]) {
            revert DelegatorAlreadyMigrated(identityId, msg.sender);
        }

        // Stake migration
        IERC20Metadata shares = IERC20Metadata(oldProfileStorage.getSharesContractAddress(identityId));

        uint256 sharesTotalSupply = shares.totalSupply();
        uint256 delegatorSharesAmount = shares.balanceOf(msg.sender);

        shares.transferFrom(msg.sender, address(this), delegatorSharesAmount);

        uint96 delegatorStakeBase = uint96((oldNodeStakes[identityId] * delegatorSharesAmount) / sharesTotalSupply);
        newStakingStorage.setDelegatorStakeBase(
            identityId,
            keccak256(abi.encodePacked(msg.sender)),
            delegatorStakeBase
        );

        migratedStake += delegatorStakeBase;

        uint256 migratedNodeShares = shares.balanceOf(address(this));
        if (migratedNodeShares == sharesTotalSupply) {
            nodeMigrated[identityId] = true;
            migratedNodes += 1;
        }

        // Delegator withdrawal migration
        uint96 withdrawalAmount = oldStakingStorage.getWithdrawalRequestAmount(identityId, msg.sender);
        if (withdrawalAmount > 0) {
            uint256 withdrawalTimestamp = oldStakingStorage.getWithdrawalRequestTimestamp(identityId, msg.sender);

            newStakingStorage.createDelegatorWithdrawalRequest(
                identityId,
                keccak256(abi.encodePacked(msg.sender)),
                withdrawalAmount,
                0,
                withdrawalTimestamp
            );
        }

        delegatorMigrated[identityId][msg.sender] = true;

        // Node operator fees and withdrawal migration
        if (
            !operatorMigrated[identityId] &&
            newIdentityStorage.keyHasPurpose(identityId, keccak256(abi.encodePacked(msg.sender)), IdentityLib.ADMIN_KEY)
        ) {
            uint96 operatorAccumulatedOperatorFee = oldProfileStorage.getAccumulatedOperatorFee(identityId);
            newStakingStorage.setOperatorFeeBalance(identityId, operatorAccumulatedOperatorFee);

            oldMigratedOperatorFees += operatorAccumulatedOperatorFee;

            uint96 feeWithdrawalAmount = oldProfileStorage.getAccumulatedOperatorFeeWithdrawalAmount(identityId);
            if (feeWithdrawalAmount > 0) {
                uint256 feeWithdrawalTimestamp = oldProfileStorage.getAccumulatedOperatorFeeWithdrawalTimestamp(
                    identityId
                );

                newStakingStorage.createOperatorFeeWithdrawalRequest(
                    identityId,
                    feeWithdrawalAmount,
                    0,
                    feeWithdrawalTimestamp
                );
            }

            operatorMigrated[identityId] = true;
        }
    }
}
