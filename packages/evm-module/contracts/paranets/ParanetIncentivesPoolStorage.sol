// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {HubDependent} from "../abstract/HubDependent.sol";
import {ParanetsRegistry} from "../storage/paranets/ParanetsRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";
import {IInitializable} from "../interfaces/IInitializable.sol";
import {ParanetLib} from "../libraries/ParanetLib.sol";
import {HubLib} from "../libraries/HubLib.sol";

contract ParanetIncentivesPoolStorage is INamed, IVersioned, HubDependent, IInitializable {
    event TokenRewardDeposit(address sender, uint256 amount);
    event VoterWeightUpdated(address indexed voter, uint96 oldWeight, uint96 newWeight);
    event TotalMinersclaimedTokenSet(uint256 oldAmount, uint256 newAmount);
    event TotalOperatorsclaimedTokenSet(uint256 oldAmount, uint256 newAmount);
    event TotalVotersclaimedTokenSet(uint256 oldAmount, uint256 newAmount);
    event TotalMinersclaimedTokenDecremented(uint256 amount, uint256 newTotal);
    event TotalOperatorsclaimedTokenDecremented(uint256 amount, uint256 newTotal);
    event TotalVotersclaimedTokenDecremented(uint256 amount, uint256 newTotal);
    event VotersRegistrarTransferred(address indexed previousRegistrar, address indexed newRegistrar);
    event MinerRewardProfileAdded(address indexed miner, uint256 amount);
    event MinerRewardIncreased(address indexed miner, uint256 additionalAmount, uint256 newTotal);
    event OperatorRewardProfileAdded(address indexed operator, uint256 amount);
    event OperatorRewardIncreased(address indexed operator, uint256 additionalAmount, uint256 newTotal);
    event VoterAdded(address indexed voter, uint16 weight);
    event VoterRemoved(address indexed voter, uint96 weight);
    event VotersRemoved(uint256 count);
    event VoterRewardClaimed(address indexed voter, uint256 amount);
    event IncentivesPoolAddressSet(address indexed oldAddress, address indexed newAddress);
    event RewardTransferred(address indexed recipient, uint256 amount);
    event TokenOriginSet(address indexed oldOrigin, address indexed newOrigin);

    string private constant _NAME = "ParanetIncentivesPoolStorage";
    string private constant _VERSION = "1.0.0";
    uint256 private constant MAX_VOTERS_PER_BATCH = 100;

    IERC20 public token;
    ParanetsRegistry public paranetsRegistry;
    address public paranetIncentivesPoolAddress;
    bytes32 public paranetId;

    // Percentage of how much tokens from total TOKEN emission goes to the Paranet Operator
    // Minimum: 0, Maximum: 10,000 (which is 100%)
    uint16 public paranetOperatorRewardPercentage;
    // Percentage of how much tokens from total TOKEN emission goes to the Paranet Incentivization
    // Proposal Voters. Minimum: 0, Maximum: 10,000 (which is 100%)
    uint16 public paranetIncentivizationProposalVotersRewardPercentage;

    // Address which can set Voters list and update Total TOKEN Emission multiplier
    address public votersRegistrar;

    uint256 public totalMinersclaimedToken;
    uint256 public totalOperatorsclaimedToken;
    uint256 public totalVotersclaimedToken;

    ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[] public claimedMinerRewards;
    mapping(address => uint256) public claimedMinerRewardsIndexes;

    ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[] public claimedOperatorRewards;
    mapping(address => uint256) public claimedOperatorRewardsIndexes;

    uint96 public cumulativeVotersWeight;
    ParanetLib.ParanetIncentivizationProposalVoter[] public voters;
    mapping(address => uint256) public votersIndexes;

    address public tokenOrigin;

    constructor(
        address hubAddress,
        address rewardTokenAddress,
        bytes32 paranetId_,
        uint16 paranetOperatorRewardPercentage_,
        uint16 paranetIncentivizationProposalVotersRewardPercentage_
    ) HubDependent(hubAddress) {
        require(
            paranetOperatorRewardPercentage_ + paranetIncentivizationProposalVotersRewardPercentage_ <
                ParanetLib.PERCENTAGE_SCALING_FACTOR,
            "Invalid rewards ratio"
        );

        if (rewardTokenAddress != address(0)) {
            token = IERC20(rewardTokenAddress);
        }

        ParanetsRegistry pr = ParanetsRegistry(hub.getContractAddress("ParanetsRegistry"));
        require(pr.paranetExists(paranetId_), "Non existent paranet");
        paranetId = paranetId_;

        paranetOperatorRewardPercentage = paranetOperatorRewardPercentage_;
        paranetIncentivizationProposalVotersRewardPercentage = paranetIncentivizationProposalVotersRewardPercentage_;
        votersRegistrar = hub.owner();
    }

    function initialize() public onlyContracts {
        paranetsRegistry = ParanetsRegistry(hub.getContractAddress("ParanetsRegistry"));
    }

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    receive() external payable {
        emit TokenRewardDeposit(msg.sender, msg.value);
    }

    function totalReceived() external view returns (uint256) {
        return getBalance() + totalMinersclaimedToken + totalOperatorsclaimedToken + totalVotersclaimedToken;
    }

    function transferVotersRegistrarRole(address newRegistrar) external onlyHubOwnerOrMultiSigOwner {
        require(newRegistrar != address(0), "New registrar cannot be zero address");
        address oldRegistrar = votersRegistrar;
        votersRegistrar = newRegistrar;
        emit VotersRegistrarTransferred(oldRegistrar, newRegistrar);
    }

    function getAllRewardedMiners()
        external
        view
        returns (ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[] memory)
    {
        return claimedMinerRewards;
    }

    function minerclaimedToken(address minerAddress) external view returns (uint256) {
        return claimedMinerRewards[claimedMinerRewardsIndexes[minerAddress]].claimedToken;
    }

    function operatorclaimedToken(address operatorAddress) external view returns (uint256) {
        return claimedOperatorRewards[claimedOperatorRewardsIndexes[operatorAddress]].claimedToken;
    }

    function addMinerClaimedRewardProfile(address addr, uint256 claimableTokenReward) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        claimedMinerRewardsIndexes[addr] = claimedMinerRewards.length;
        claimedMinerRewards.push(
            ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile({addr: addr, claimedToken: claimableTokenReward})
        );
        emit MinerRewardProfileAdded(addr, claimableTokenReward);
    }

    function addMinerClaimedReward(address addr, uint256 claimableTokenReward) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        uint256 newTotal = claimedMinerRewards[claimedMinerRewardsIndexes[addr]].claimedToken + claimableTokenReward;
        claimedMinerRewards[claimedMinerRewardsIndexes[addr]].claimedToken = newTotal;
        emit MinerRewardIncreased(addr, claimableTokenReward, newTotal);
    }

    function addOperatorClaimedRewardsProfile(address addr, uint256 claimableTokenReward) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        claimedOperatorRewardsIndexes[addr] = claimedOperatorRewards.length;
        claimedOperatorRewards.push(
            ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile({addr: addr, claimedToken: claimableTokenReward})
        );
        emit OperatorRewardProfileAdded(addr, claimableTokenReward);
    }

    function addClaimedOperatorReward(address addr, uint256 claimableTokenReward) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        uint256 newTotal = claimedOperatorRewards[claimedOperatorRewardsIndexes[addr]].claimedToken +
            claimableTokenReward;
        claimedOperatorRewards[claimedOperatorRewardsIndexes[addr]].claimedToken = newTotal;
        emit OperatorRewardIncreased(addr, claimableTokenReward, newTotal);
    }

    function getAllRewardedOperators()
        external
        view
        returns (ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[] memory)
    {
        return claimedOperatorRewards;
    }

    function addVoters(
        ParanetLib.ParanetIncentivizationProposalVoterInput[] calldata voters_
    ) external onlyVotersRegistrar {
        require(voters_.length <= MAX_VOTERS_PER_BATCH, "Batch too large");
        for (uint256 i; i < voters_.length; ) {
            address voterAddr = voters_[i].addr;
            uint16 weight = uint16(voters_[i].weight);

            uint256 existingIndex = votersIndexes[voterAddr];
            if (existingIndex < voters.length && voters[existingIndex].addr == voterAddr) {
                revert("Voter already exists");
            }

            votersIndexes[voterAddr] = voters.length;
            voters.push(
                ParanetLib.ParanetIncentivizationProposalVoter({addr: voterAddr, weight: weight, claimedToken: 0})
            );

            cumulativeVotersWeight += weight;

            emit VoterAdded(voterAddr, weight);

            unchecked {
                i++;
            }
        }

        require(cumulativeVotersWeight <= ParanetLib.MAX_CUMULATIVE_VOTERS_WEIGHT, "Cumulative weight is too big");
    }

    function removeVoters(address[] calldata votersToRemove) external onlyVotersRegistrar {
        for (uint256 i; i < votersToRemove.length; ) {
            removeVoter(votersToRemove[i]);
            unchecked {
                i++;
            }
        }
    }

    function removeVoter(address voterAddress) public onlyVotersRegistrar {
        uint256 index = votersIndexes[voterAddress];
        require(index < voters.length, "Invalid voter index");

        ParanetLib.ParanetIncentivizationProposalVoter memory voterToRemove = voters[index];
        require(voterToRemove.addr == voterAddress, "Voter not found");

        uint96 removedWeight = voterToRemove.weight;
        require(cumulativeVotersWeight >= removedWeight, "Weight underflow");

        // Move last element to deleted position
        uint256 lastIndex = voters.length - 1;
        if (index != lastIndex) {
            ParanetLib.ParanetIncentivizationProposalVoter memory lastVoter = voters[lastIndex];
            voters[index] = lastVoter;
            votersIndexes[lastVoter.addr] = index;
        }

        voters.pop();
        delete votersIndexes[voterAddress];
        cumulativeVotersWeight -= removedWeight;

        emit VoterRemoved(voterAddress, removedWeight);
    }

    function getVotersCount() external view returns (uint256) {
        return voters.length;
    }

    function getVoters() external view returns (ParanetLib.ParanetIncentivizationProposalVoter[] memory) {
        return voters;
    }

    function getVoter(
        address voterAddress
    ) external view returns (ParanetLib.ParanetIncentivizationProposalVoter memory) {
        require(voters.length > 0, "Address is not a registered voter");

        uint256 index = votersIndexes[voterAddress];
        require(index < voters.length && voters[index].addr == voterAddress, "Address is not a registered voter");

        return voters[index];
    }

    function getVoterAtIndex(
        uint256 index
    ) external view returns (ParanetLib.ParanetIncentivizationProposalVoter memory) {
        require(index < voters.length, "Index is out of bounds");
        return voters[index];
    }

    function isProposalVoter(address addr) external view returns (bool) {
        if (voters.length == 0) return false;
        uint256 idx = votersIndexes[addr];
        return (idx < voters.length && voters[idx].addr == addr);
    }

    function addVoterClaimedToken(address voter, uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        uint256 idx = votersIndexes[voter];
        if (idx < voters.length && voters[idx].addr == voter) {
            voters[idx].claimedToken += amount;
            emit VoterRewardClaimed(voter, amount);
        }
    }

    function getClaimedMinerRewardsLength() external view returns (uint256) {
        return claimedMinerRewards.length;
    }

    function getClaimedMinerRewardsAtIndex(
        uint256 index
    ) external view returns (ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile memory) {
        require(index < claimedMinerRewards.length, "Index is out of bounds");
        return claimedMinerRewards[index];
    }

    function getClaimedOperatorRewardsLength() external view returns (uint256) {
        return claimedOperatorRewards.length;
    }

    function getClaimedOperatorRewardsAtIndex(
        uint256 index
    ) external view returns (ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile memory) {
        require(index < claimedOperatorRewards.length, "Index is out of bounds");
        return claimedOperatorRewards[index];
    }

    function addTotalMinersclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalMinersclaimedToken += amount;
    }

    function addTotalOperatorsclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalOperatorsclaimedToken += amount;
    }

    function addTotalVotersclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalVotersclaimedToken += amount;
    }

    function setParanetIncentivesPool(address _paranetIncentivesPoolAddress) external onlyContracts {
        address oldAddress = paranetIncentivesPoolAddress;
        paranetIncentivesPoolAddress = _paranetIncentivesPoolAddress;
        emit IncentivesPoolAddressSet(oldAddress, _paranetIncentivesPoolAddress);
    }

    function getBalance() public view returns (uint256) {
        if (address(token) == address(0)) {
            return address(this).balance;
        } else {
            return token.balanceOf(address(this));
        }
    }

    function transferReward(address rewardAddress, uint256 amount) public {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        if (address(token) == address(0)) {
            payable(rewardAddress).transfer(amount);
        } else {
            token.transfer(rewardAddress, amount);
        }
        emit RewardTransferred(rewardAddress, amount);
    }

    function setTotalMinersclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalMinersclaimedToken = amount;
    }

    function setTotalOperatorsclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalOperatorsclaimedToken = amount;
    }

    function setTotalVotersclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalVotersclaimedToken = amount;
    }

    function decrementTotalMinersclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalMinersclaimedToken -= amount;
    }

    function decrementTotalOperatorsclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalOperatorsclaimedToken -= amount;
    }

    function decrementTotalVotersclaimedToken(uint256 amount) external {
        require(msg.sender == paranetIncentivesPoolAddress, "Caller is not incentives pool contract");
        totalVotersclaimedToken -= amount;
    }

    function getPaginatedClaimedMinerRewards(
        uint256 offset,
        uint256 limit
    ) external view returns (ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[] memory rewards, uint256 total) {
        total = claimedMinerRewards.length;

        if (offset >= total || limit == 0) {
            return (new ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLength = end - offset;

        rewards = new ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            rewards[i] = claimedMinerRewards[offset + i];
        }
    }

    function getPaginatedClaimedOperatorRewards(
        uint256 offset,
        uint256 limit
    ) external view returns (ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[] memory rewards, uint256 total) {
        total = claimedOperatorRewards.length;

        if (offset >= total || limit == 0) {
            return (new ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLength = end - offset;

        rewards = new ParanetLib.ParanetIncentivesPoolClaimedRewardsProfile[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            rewards[i] = claimedOperatorRewards[offset + i];
        }
    }

    function getPaginatedVoters(
        uint256 offset,
        uint256 limit
    ) external view returns (ParanetLib.ParanetIncentivizationProposalVoter[] memory votersList, uint256 total) {
        total = voters.length;

        if (offset >= total || limit == 0) {
            return (new ParanetLib.ParanetIncentivizationProposalVoter[](0), total);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 resultLength = end - offset;

        votersList = new ParanetLib.ParanetIncentivizationProposalVoter[](resultLength);
        for (uint256 i = 0; i < resultLength; i++) {
            votersList[i] = voters[offset + i];
        }
    }

    function updateVoterWeight(address voter, uint96 newWeight) external onlyVotersRegistrar {
        uint256 index = votersIndexes[voter];
        require(index < voters.length && voters[index].addr == voter, "Voter not found");

        uint96 oldWeight = voters[index].weight;
        require(
            cumulativeVotersWeight - oldWeight + newWeight <= ParanetLib.MAX_CUMULATIVE_VOTERS_WEIGHT,
            "New weight would exceed maximum"
        );

        cumulativeVotersWeight = cumulativeVotersWeight - oldWeight + newWeight;
        voters[index].weight = newWeight;

        emit VoterWeightUpdated(voter, oldWeight, newWeight);
    }

    function setTokenOrigin(address newOrigin) external onlyContracts {
        require(newOrigin != address(0), "Token origin cannot be zero address");
        address oldOrigin = tokenOrigin;
        tokenOrigin = newOrigin;
        emit TokenOriginSet(oldOrigin, newOrigin);
    }

    modifier onlyVotersRegistrar() {
        require(msg.sender == votersRegistrar, "Fn can only be used by registrar");
        _;
    }

    function _isMultiSigOwner(address multiSigAddress) internal view returns (bool) {
        // Check if the address is a contract
        uint256 size;
        assembly {
            size := extcodesize(multiSigAddress)
        }
        if (size == 0) {
            return false;
        }

        // Call the getOwners function on the multiSigAddress
        (bool success, bytes memory returnData) = multiSigAddress.staticcall(abi.encodeWithSignature("getOwners()"));

        // If call failed or returned invalid data, return false
        if (!success || returnData.length == 0) {
            return false;
        }

        // Decode the returned data
        address[] memory multiSigOwners = abi.decode(returnData, (address[]));

        // Check if msg.sender is one of the owners
        for (uint256 i = 0; i < multiSigOwners.length; i++) {
            if (msg.sender == multiSigOwners[i]) {
                return true;
            }
        }

        return false;
    }

    function _checkHubOwnerOrMultiSigOwner() internal view virtual {
        address hubOwner = hub.owner();
        if (msg.sender != hubOwner && !_isMultiSigOwner(hubOwner)) {
            revert HubLib.UnauthorizedAccess("Only Hub Owner or Multisig Owner");
        }
    }

    modifier onlyHubOwnerOrMultiSigOwner() {
        _checkHubOwnerOrMultiSigOwner();
        _;
    }
}
