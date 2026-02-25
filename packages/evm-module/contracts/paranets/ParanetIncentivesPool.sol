// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {ParanetKnowledgeMinersRegistry} from "../storage/paranets/ParanetKnowledgeMinersRegistry.sol";
import {ParanetsRegistry} from "../storage/paranets/ParanetsRegistry.sol";
import {ParanetIncentivesPoolStorage} from "./ParanetIncentivesPoolStorage.sol";
import {KnowledgeCollectionStorage} from "../storage/KnowledgeCollectionStorage.sol";
import {Hub} from "../storage/Hub.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";
import {ParanetLib} from "../libraries/ParanetLib.sol";
import {IParanetIncentivesPool} from "../interfaces/IParanetIncentivesPool.sol";

contract ParanetIncentivesPool is INamed, IVersioned, IParanetIncentivesPool {
    event TokenEmissionMultiplierUpdateInitiated(uint256 oldMultiplier, uint256 newMultiplier, uint256 timestamp);
    event TokenEmissionMultiplierUpdateFinalized(uint256 oldMultiplier, uint256 newMultiplier);

    string private constant _NAME = "ParanetIncentivesPool";
    string private constant _VERSION = "1.0.0";

    Hub public hub;
    ParanetsRegistry public paranetsRegistry;
    ParanetKnowledgeMinersRegistry public paranetKnowledgeMinersRegistry;
    ParanetIncentivesPoolStorage public paranetIncentivesPoolStorage;

    // Array of Total TOKEN Emission Multipliers
    // Total TOKEN Emission Multiplier = Ratio of how much TOKEN is released per 1 TRAC spent
    //
    // Examples:
    //      1 * 10^12 = 1 TOKEN per 1 TRAC
    //      0.5 * 10^12 = 5 * 10^11 = 0.5 TOKEN per 1 TRAC
    //      1 = 1 TOKEN wei per 1 TRAC
    //
    ParanetLib.TokenEmissionMultiplier[] public tokenEmissionMultipliers;

    uint256 public tokenEmissionMultiplierUpdateDelay = 7 days;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        address hubAddress,
        address knowledgeMinersRegistryAddress,
        address paranetIncentivesPoolStorageAddress,
        address paranetsRegistryAddress,
        uint256 tracToTokenEmissionMultiplier
    ) {
        hub = Hub(hubAddress);
        paranetKnowledgeMinersRegistry = ParanetKnowledgeMinersRegistry(knowledgeMinersRegistryAddress);
        paranetIncentivesPoolStorage = ParanetIncentivesPoolStorage(payable(paranetIncentivesPoolStorageAddress));
        paranetsRegistry = ParanetsRegistry(paranetsRegistryAddress);

        tokenEmissionMultipliers.push(
            ParanetLib.TokenEmissionMultiplier({
                multiplier: tracToTokenEmissionMultiplier,
                timestamp: block.timestamp,
                finalized: true
            })
        );
    }

    modifier onlyHubOwner() {
        _checkHubOwner();
        _;
    }

    modifier onlyVotersRegistrar() {
        _checkVotersRegistrar();
        _;
    }

    modifier onlyParanetOperator() {
        _checkParanetOperator();
        _;
    }

    modifier onlyParanetIncentivizationProposalVoter() {
        _checkParanetIncentivizationProposalVoter();
        _;
    }

    modifier onlyParanetKnowledgeMiner() {
        _checkParanetKnowledgeMiner();
        _;
    }

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    function updatetokenEmissionMultiplierUpdateDelay(uint256 newDelay) external onlyHubOwner {
        tokenEmissionMultiplierUpdateDelay = newDelay;
    }

    function voterclaimedToken(address addr) external view returns (uint256) {
        uint256 voterIndex = paranetIncentivesPoolStorage.votersIndexes(addr);

        // If the index is out of range or the stored voter doesn't match `voterAddress`,
        // return 0 as a default.
        if (
            voterIndex >= paranetIncentivesPoolStorage.getVotersCount() ||
            paranetIncentivesPoolStorage.getVoterAtIndex(voterIndex).addr != addr
        ) {
            return 0;
        }

        return paranetIncentivesPoolStorage.getVoterAtIndex(voterIndex).claimedToken;
    }

    function isKnowledgeMiner(address addr) public view returns (bool) {
        return paranetsRegistry.isKnowledgeMinerRegistered(paranetIncentivesPoolStorage.paranetId(), addr);
    }

    function isParanetOperator(address addr) public view returns (bool) {
        (address paranetKCStorageContract, uint256 paranetKCTokenId, uint256 paranetKATokenId) = paranetsRegistry
            .getParanetKnowledgeAssetLocator(paranetIncentivesPoolStorage.paranetId());

        KnowledgeCollectionStorage knowledgeCollectionStorage = KnowledgeCollectionStorage(paranetKCStorageContract);

        uint256 startTokenId = (paranetKCTokenId - 1) *
            knowledgeCollectionStorage.knowledgeCollectionMaxSize() +
            paranetKATokenId;

        uint256 ownedCountInRange = knowledgeCollectionStorage.balanceOf(addr, startTokenId, startTokenId + 1);

        return ownedCountInRange == 1;
    }

    function isProposalVoter(address addr) public view returns (bool) {
        return (paranetIncentivesPoolStorage.getVotersCount() != 0 &&
            paranetIncentivesPoolStorage.getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(addr)).addr ==
            addr);
    }

    function gettokenEmissionMultipliers() external view returns (ParanetLib.TokenEmissionMultiplier[] memory) {
        return tokenEmissionMultipliers;
    }

    function getEffectiveTokenEmissionMultiplier(uint256 timestamp) public view returns (uint256) {
        for (uint256 i = tokenEmissionMultipliers.length; i > 0; i--) {
            if (tokenEmissionMultipliers[i - 1].finalized && timestamp >= tokenEmissionMultipliers[i - 1].timestamp) {
                return tokenEmissionMultipliers[i - 1].multiplier;
            }
        }
        return tokenEmissionMultipliers[0].multiplier;
    }

    // TODO:Should there be some check of this value?
    function initiateTokenEmissionMultiplierUpdate(uint256 newMultiplier) external onlyVotersRegistrar {
        if (!tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].finalized) {
            tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].multiplier = newMultiplier;
            tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].timestamp =
                block.timestamp +
                tokenEmissionMultiplierUpdateDelay;
        } else {
            tokenEmissionMultipliers.push(
                ParanetLib.TokenEmissionMultiplier({
                    multiplier: newMultiplier,
                    timestamp: block.timestamp + tokenEmissionMultiplierUpdateDelay,
                    finalized: false
                })
            );
        }

        emit TokenEmissionMultiplierUpdateInitiated(
            tokenEmissionMultipliers[tokenEmissionMultipliers.length - 2].multiplier,
            newMultiplier,
            block.timestamp + tokenEmissionMultiplierUpdateDelay
        );
    }

    function finalizeTokenEmissionMultiplierUpdate() external onlyVotersRegistrar {
        require(tokenEmissionMultipliers.length > 0, "No emission multiplier updates");
        require(
            !tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].finalized,
            "Last update already finalized"
        );
        require(
            block.timestamp >= tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].timestamp,
            "Delay period not yet passed"
        );

        tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].finalized = true;

        emit TokenEmissionMultiplierUpdateFinalized(
            tokenEmissionMultipliers[tokenEmissionMultipliers.length - 2].multiplier,
            tokenEmissionMultipliers[tokenEmissionMultipliers.length - 1].multiplier
        );
    }

    function getTotalKnowledgeMinerIncentiveEstimation() public view returns (uint256) {
        uint96 unrewardedTracSpent = paranetKnowledgeMinersRegistry.getUnrewardedTracSpent(
            msg.sender,
            paranetIncentivesPoolStorage.paranetId()
        );

        if (unrewardedTracSpent < ParanetLib.TOKENS_DIGITS_DIFF) {
            return 0;
        }

        // Unrewarded TRAC Spent = how much TRAC Knowledge Miner spent for Mining and haven't got a reward for
        // Effective Emission Ratio = Current active Multiplier for how much TOKEN is released per TRAC spent
        //
        // Basic Formula:
        // Reward = UnrewardedTRAC * TotalEmissionRatio * (MinersRewardPercentage / 100)
        //
        // Example:
        // Let's say we have 10 unrewarded TRAC, 0.5 TOKEN per TRAC Total Emission and 80% Miners Reward Percentage,
        // 10% Operator Reward Percentage, 10% Voters Reward Percentage
        // Reward = (((10 * 10^18) * (5 * 10^11)) / (10^18)) * (10,000 - 1,000 - 1,000) / 10,000) =
        // = 10 * 5 * 10^11 * 8,000 / 10,000 = 8/10 * (5 * 10^12) = 80% of 5 TOKEN = 4 TOKEN
        return
            (((unrewardedTracSpent * getEffectiveTokenEmissionMultiplier(block.timestamp)) /
                ParanetLib.EMISSION_MULTIPLIER_SCALING_FACTOR) *
                (ParanetLib.PERCENTAGE_SCALING_FACTOR -
                    paranetIncentivesPoolStorage.paranetOperatorRewardPercentage() -
                    paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage())) /
            ParanetLib.PERCENTAGE_SCALING_FACTOR;
    }

    function getTotalAllKnowledgeMinersIncentiveEstimation() public view returns (uint256) {
        return
            _getIncentiveEstimation(
                ParanetLib.PERCENTAGE_SCALING_FACTOR -
                    paranetIncentivesPoolStorage.paranetOperatorRewardPercentage() -
                    paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage(),
                paranetIncentivesPoolStorage.totalMinersclaimedToken()
            );
    }

    function getClaimableKnowledgeMinerRewardAmount() public view returns (uint256) {
        uint256 tokenReward = getTotalKnowledgeMinerIncentiveEstimation();

        // Here we should have a limit for Knowledge Miners, which is determined by the % of the Miners Reward
        // and total TOKEN received by the contract, so that Miners don't get tokens belonging to Operator/Voters
        // Following the example from the above, if we have 100 TOKEN as a total reward, Miners should never get
        // more than 80 TOKEN. minersRewardLimit = 80 TOKEN
        uint256 totalMinersclaimedToken = paranetIncentivesPoolStorage.totalMinersclaimedToken();
        uint256 minersRewardLimit = ((paranetIncentivesPoolStorage.getBalance() +
            totalMinersclaimedToken +
            paranetIncentivesPoolStorage.totalOperatorsclaimedToken() +
            paranetIncentivesPoolStorage.totalVotersclaimedToken()) *
            (ParanetLib.PERCENTAGE_SCALING_FACTOR -
                paranetIncentivesPoolStorage.paranetOperatorRewardPercentage() -
                paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage())) /
            ParanetLib.PERCENTAGE_SCALING_FACTOR;

        return
            totalMinersclaimedToken + tokenReward <= minersRewardLimit
                ? tokenReward
                : minersRewardLimit - totalMinersclaimedToken;
    }

    function getClaimableAllKnowledgeMinersRewardAmount() public view returns (uint256) {
        uint256 tokenReward = getTotalAllKnowledgeMinersIncentiveEstimation();

        uint256 minersRewardLimit = ((paranetIncentivesPoolStorage.getBalance() +
            paranetIncentivesPoolStorage.totalMinersclaimedToken() +
            paranetIncentivesPoolStorage.totalOperatorsclaimedToken() +
            paranetIncentivesPoolStorage.totalVotersclaimedToken()) *
            (ParanetLib.PERCENTAGE_SCALING_FACTOR -
                paranetIncentivesPoolStorage.paranetOperatorRewardPercentage() -
                paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage())) /
            ParanetLib.PERCENTAGE_SCALING_FACTOR;

        return
            paranetIncentivesPoolStorage.totalMinersclaimedToken() + tokenReward <= minersRewardLimit
                ? tokenReward
                : minersRewardLimit - paranetIncentivesPoolStorage.totalMinersclaimedToken();
    }

    function claimKnowledgeMinerReward(uint256 amount) external onlyParanetKnowledgeMiner {
        ParanetKnowledgeMinersRegistry pkmr = paranetKnowledgeMinersRegistry;

        uint256 tokenReward = getTotalKnowledgeMinerIncentiveEstimation();
        uint256 claimableTokenReward = getClaimableKnowledgeMinerRewardAmount();
        if (claimableTokenReward == 0 || amount == 0 || amount > claimableTokenReward) {
            revert ParanetLib.NoRewardAvailable(paranetIncentivesPoolStorage.paranetId(), msg.sender);
        }

        uint96 newUnrewardedTracSpent = amount == tokenReward
            ? 0
            : uint96(
                ((tokenReward - amount) * ParanetLib.EMISSION_MULTIPLIER_SCALING_FACTOR) /
                    getEffectiveTokenEmissionMultiplier(block.timestamp)
            );

        pkmr.setUnrewardedTracSpent(msg.sender, paranetIncentivesPoolStorage.paranetId(), newUnrewardedTracSpent);
        pkmr.addcumulativeAwardedToken(msg.sender, paranetIncentivesPoolStorage.paranetId(), amount);

        if (
            paranetIncentivesPoolStorage.getClaimedMinerRewardsLength() == 0 ||
            paranetIncentivesPoolStorage
                .getClaimedMinerRewardsAtIndex(paranetIncentivesPoolStorage.claimedMinerRewardsIndexes(msg.sender))
                .addr !=
            msg.sender
        ) {
            paranetIncentivesPoolStorage.addMinerClaimedRewardProfile(msg.sender, amount);
        } else {
            paranetIncentivesPoolStorage.addMinerClaimedReward(msg.sender, amount);
        }
        paranetIncentivesPoolStorage.addTotalMinersclaimedToken(amount);

        paranetIncentivesPoolStorage.transferReward(msg.sender, amount);
    }

    function getTotalParanetOperatorIncentiveEstimation() public view returns (uint256) {
        return
            _getIncentiveEstimation(
                paranetIncentivesPoolStorage.paranetOperatorRewardPercentage(),
                paranetIncentivesPoolStorage.totalOperatorsclaimedToken()
            );
    }

    function getClaimableParanetOperatorRewardAmount() public view returns (uint256) {
        uint256 tokenReward = getTotalParanetOperatorIncentiveEstimation();

        uint256 operatorRewardLimit = ((paranetIncentivesPoolStorage.getBalance() +
            paranetIncentivesPoolStorage.totalMinersclaimedToken() +
            paranetIncentivesPoolStorage.totalOperatorsclaimedToken() +
            paranetIncentivesPoolStorage.totalVotersclaimedToken()) *
            paranetIncentivesPoolStorage.paranetOperatorRewardPercentage()) / ParanetLib.PERCENTAGE_SCALING_FACTOR;

        return
            paranetIncentivesPoolStorage.totalOperatorsclaimedToken() + tokenReward <= operatorRewardLimit
                ? tokenReward
                : operatorRewardLimit - paranetIncentivesPoolStorage.totalOperatorsclaimedToken();
    }

    function claimParanetOperatorReward() external onlyParanetOperator {
        uint256 claimableTokenReward = getClaimableParanetOperatorRewardAmount();

        if (claimableTokenReward == 0) {
            revert ParanetLib.NoRewardAvailable(paranetIncentivesPoolStorage.paranetId(), msg.sender);
        }

        if (
            paranetIncentivesPoolStorage.getClaimedOperatorRewardsLength() == 0 ||
            paranetIncentivesPoolStorage
                .getClaimedOperatorRewardsAtIndex(
                    paranetIncentivesPoolStorage.claimedOperatorRewardsIndexes(msg.sender)
                )
                .addr !=
            msg.sender
        ) {
            paranetIncentivesPoolStorage.addOperatorClaimedRewardsProfile(msg.sender, claimableTokenReward);
        } else {
            paranetIncentivesPoolStorage.addClaimedOperatorReward(msg.sender, claimableTokenReward);
        }
        paranetIncentivesPoolStorage.addTotalOperatorsclaimedToken(claimableTokenReward);

        paranetIncentivesPoolStorage.transferReward(msg.sender, claimableTokenReward);
    }

    function getTotalProposalVoterIncentiveEstimation() public view returns (uint256) {
        uint256 effectiveTokenEmissionMultiplier = getEffectiveTokenEmissionMultiplier(block.timestamp);
        uint96 cumulativeKnowledgeValueSingleVoterPart = (((paranetsRegistry.getCumulativeKnowledgeValue(
            paranetIncentivesPoolStorage.paranetId()
        ) * paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage()) /
            ParanetLib.PERCENTAGE_SCALING_FACTOR) *
            paranetIncentivesPoolStorage
                .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
                .weight) / ParanetLib.MAX_CUMULATIVE_VOTERS_WEIGHT;
        uint96 rewardedTracSpentSingleVoterPart = uint96(
            (paranetIncentivesPoolStorage
                .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
                .claimedToken * ParanetLib.EMISSION_MULTIPLIER_SCALING_FACTOR) / effectiveTokenEmissionMultiplier
        );

        if (
            cumulativeKnowledgeValueSingleVoterPart - rewardedTracSpentSingleVoterPart < ParanetLib.TOKENS_DIGITS_DIFF
        ) {
            return 0;
        }

        return
            ((cumulativeKnowledgeValueSingleVoterPart * effectiveTokenEmissionMultiplier) /
                ParanetLib.EMISSION_MULTIPLIER_SCALING_FACTOR) -
            paranetIncentivesPoolStorage
                .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
                .claimedToken;
    }

    function getTotalAllProposalVotersIncentiveEstimation() public view returns (uint256) {
        return
            _getIncentiveEstimation(
                paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage(),
                paranetIncentivesPoolStorage.totalVotersclaimedToken()
            );
    }

    function getClaimableProposalVoterRewardAmount() public view returns (uint256) {
        if (
            paranetIncentivesPoolStorage.getVotersCount() == 0 ||
            paranetIncentivesPoolStorage.getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender)).addr !=
            msg.sender
        ) {
            return 0;
        }

        uint256 tokenReward = getTotalProposalVoterIncentiveEstimation();

        uint256 voterRewardLimit = ((((paranetIncentivesPoolStorage.getBalance() +
            paranetIncentivesPoolStorage.totalMinersclaimedToken() +
            paranetIncentivesPoolStorage.totalOperatorsclaimedToken() +
            paranetIncentivesPoolStorage.totalVotersclaimedToken()) *
            paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage()) /
            ParanetLib.PERCENTAGE_SCALING_FACTOR) *
            paranetIncentivesPoolStorage
                .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
                .weight) / ParanetLib.MAX_CUMULATIVE_VOTERS_WEIGHT;

        return
            paranetIncentivesPoolStorage
                .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
                .claimedToken +
                tokenReward <=
                voterRewardLimit
                ? tokenReward
                : voterRewardLimit -
                    paranetIncentivesPoolStorage
                        .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
                        .claimedToken;
    }

    function getClaimableAllProposalVotersRewardAmount() public view returns (uint256) {
        uint256 tokenReward = getTotalAllProposalVotersIncentiveEstimation();

        uint256 votersRewardLimit = ((paranetIncentivesPoolStorage.getBalance() +
            paranetIncentivesPoolStorage.totalMinersclaimedToken() +
            paranetIncentivesPoolStorage.totalOperatorsclaimedToken() +
            paranetIncentivesPoolStorage.totalVotersclaimedToken()) *
            paranetIncentivesPoolStorage.paranetIncentivizationProposalVotersRewardPercentage()) /
            ParanetLib.PERCENTAGE_SCALING_FACTOR;

        return
            paranetIncentivesPoolStorage.totalVotersclaimedToken() + tokenReward <= votersRewardLimit
                ? tokenReward
                : votersRewardLimit - paranetIncentivesPoolStorage.totalVotersclaimedToken();
    }

    function claimIncentivizationProposalVoterReward() external onlyParanetIncentivizationProposalVoter {
        if (paranetIncentivesPoolStorage.cumulativeVotersWeight() != ParanetLib.MAX_CUMULATIVE_VOTERS_WEIGHT) {
            revert ParanetLib.InvalidCumulativeVotersWeight(
                paranetIncentivesPoolStorage.paranetId(),
                paranetIncentivesPoolStorage.cumulativeVotersWeight(),
                ParanetLib.MAX_CUMULATIVE_VOTERS_WEIGHT
            );
        }

        uint256 claimableTokenReward = getClaimableProposalVoterRewardAmount();

        if (claimableTokenReward == 0) {
            revert ParanetLib.NoRewardAvailable(paranetIncentivesPoolStorage.paranetId(), msg.sender);
        }

        paranetIncentivesPoolStorage
            .getVoterAtIndex(paranetIncentivesPoolStorage.votersIndexes(msg.sender))
            .claimedToken += claimableTokenReward;
        paranetIncentivesPoolStorage.addTotalVotersclaimedToken(claimableTokenReward);

        paranetIncentivesPoolStorage.transferReward(msg.sender, claimableTokenReward);
    }

    function _getIncentiveEstimation(
        uint16 rewardPercentage,
        uint256 totalclaimedToken
    ) internal view returns (uint256) {
        uint256 effectiveTokenEmissionMultiplier = getEffectiveTokenEmissionMultiplier(block.timestamp);
        uint96 cumulativeKnowledgeValuePart = (paranetsRegistry.getCumulativeKnowledgeValue(
            paranetIncentivesPoolStorage.paranetId()
        ) * rewardPercentage) / ParanetLib.PERCENTAGE_SCALING_FACTOR;
        uint96 rewardedTracSpentPart = uint96(
            (totalclaimedToken * ParanetLib.EMISSION_MULTIPLIER_SCALING_FACTOR) / effectiveTokenEmissionMultiplier
        );

        if (cumulativeKnowledgeValuePart - rewardedTracSpentPart < ParanetLib.TOKENS_DIGITS_DIFF) {
            return 0;
        }

        return
            ((cumulativeKnowledgeValuePart * effectiveTokenEmissionMultiplier) /
                ParanetLib.EMISSION_MULTIPLIER_SCALING_FACTOR) - totalclaimedToken;
    }

    function getParanetIncentivesPoolStorage() external view returns (address) {
        return address(paranetIncentivesPoolStorage);
    }

    function _checkHubOwner() internal view virtual {
        require(msg.sender == hub.owner(), "Fn can only be used by hub owner");
    }

    function _checkVotersRegistrar() internal view virtual {
        require(msg.sender == paranetIncentivesPoolStorage.votersRegistrar(), "Fn can only be used by registrar");
    }

    function _checkParanetOperator() internal view virtual {
        require(isParanetOperator(msg.sender), "Fn can only be used by operator");
    }

    function _checkParanetIncentivizationProposalVoter() internal view virtual {
        require(isProposalVoter(msg.sender), "Fn can only be used by voter");
    }

    function _checkParanetKnowledgeMiner() internal view virtual {
        require(isKnowledgeMiner(msg.sender), "Fn can only be used by K-Miners");
    }
}
