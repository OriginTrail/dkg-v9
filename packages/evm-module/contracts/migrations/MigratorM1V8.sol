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
import {ICustodian} from "../interfaces/ICustodian.sol";

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

contract MigratorM1V8 is ContractStatus {
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

    // @dev Only transactions by HubController owner or one of the owners of the MultiSig Wallet
    modifier onlyOwnerOrMultiSigOwner() {
        _checkOwnerOrMultiSigOwner();
        _;
    }

    function initializeOldContracts() external onlyOwnerOrMultiSigOwner {
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

    function initializeNewContracts() external onlyOwnerOrMultiSigOwner {
        epochStorageV6 = EpochStorage(hub.getContractAddress("EpochStorageV6"));
        newParametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        newProfileStorage = ProfileStorage(hub.getContractAddress("ProfileStorage"));
        newShardingTable = ShardingTable(hub.getContractAddress("ShardingTable"));
        newStakingStorage = StakingStorage(hub.getContractAddress("StakingStorage"));
        newIdentityStorage = IdentityStorage(hub.getContractAddress("IdentityStorage"));
        askStorage = AskStorage(hub.getContractAddress("AskStorage"));
        token = Token(hub.getContractAddress("Token"));
    }

    // start the migration process
    function initiateDelegatorsMigration() external onlyOwnerOrMultiSigOwner {
        delegatorsMigrationInitiated = true;
    }

    // end the migration process
    function finalizeDelegatorsMigration() external onlyOwnerOrMultiSigOwner {
        delegatorsMigrationInitiated = false;
    }

    // migrate the delegator data
    function migrateDelegatorData(uint72 identityId, address delegator) external onlyOwnerOrMultiSigOwner {
        if (!delegatorsMigrationInitiated) {
            revert DelegatorsMigrationNotInitiated();
        }
        if (delegatorMigrated[identityId][delegator]) {
            revert DelegatorAlreadyMigrated(identityId, delegator);
        }

        // Stake migration
        IERC20Metadata shares = IERC20Metadata(oldProfileStorage.getSharesContractAddress(identityId));

        uint256 sharesTotalSupply = shares.totalSupply();
        uint256 delegatorSharesAmount = shares.balanceOf(delegator);

        // shares.transferFrom(delegator, address(this), delegatorSharesAmount);
        oldNodeStakes[identityId] = oldStakingStorage.totalStakes(identityId);

        // Update the delegator stake base in newStakingStorage
        uint96 delegatorStakeBase = uint96((oldNodeStakes[identityId] * delegatorSharesAmount) / sharesTotalSupply);
        newStakingStorage.setDelegatorStakeBase(identityId, keccak256(abi.encodePacked(delegator)), delegatorStakeBase);

        // Update the node and total stake in newStakingStorage
        newStakingStorage.increaseNodeStake(identityId, delegatorStakeBase);
        newStakingStorage.increaseTotalStake(delegatorStakeBase);

        migratedStake += delegatorStakeBase;

        uint256 migratedNodeShares = shares.balanceOf(address(this));
        if (migratedNodeShares == sharesTotalSupply) {
            nodeMigrated[identityId] = true;
            migratedNodes += 1;
        }

        // Delegator withdrawal migration
        uint96 withdrawalAmount = oldStakingStorage.getWithdrawalRequestAmount(identityId, delegator);
        if (withdrawalAmount > 0) {
            uint256 withdrawalTimestamp = oldStakingStorage.getWithdrawalRequestTimestamp(identityId, delegator);

            newStakingStorage.createDelegatorWithdrawalRequest(
                identityId,
                keccak256(abi.encodePacked(delegator)),
                withdrawalAmount,
                0,
                withdrawalTimestamp
            );
        }

        delegatorMigrated[identityId][delegator] = true;

        // Node operator fees and withdrawal migration
        if (
            !operatorMigrated[identityId] &&
            newIdentityStorage.keyHasPurpose(identityId, keccak256(abi.encodePacked(delegator)), IdentityLib.ADMIN_KEY)
        ) {
            uint96 V6operatorAccumulatedOperatorFee = oldProfileStorage.getAccumulatedOperatorFee(identityId);

            // uint96 currentOperatorFee = newProfileStorage.getOperatorFee(identityId);
            // newProfileStorage.setOperatorFees(identityId, currentOperatorFee + V6operatorAccumulatedOperatorFee);
            newStakingStorage.increaseOperatorFeeBalance(identityId, V6operatorAccumulatedOperatorFee);

            oldMigratedOperatorFees += V6operatorAccumulatedOperatorFee;

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
        if (msg.sender != hubOwner && msg.sender != address(hub) && !_isMultiSigOwner(hubOwner)) {
            revert("Only Hub Owner, Hub, or Multisig Owner can call");
        }
    }
}
