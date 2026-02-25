// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {AskStorage} from "./storage/AskStorage.sol";
import {ShardingTableStorage} from "./storage/ShardingTableStorage.sol";
import {ParametersStorage} from "./storage/ParametersStorage.sol";
import {ProfileStorage} from "./storage/ProfileStorage.sol";
import {StakingStorage} from "./storage/StakingStorage.sol";
import {INamed} from "./interfaces/INamed.sol";
import {IVersioned} from "./interfaces/IVersioned.sol";
import {IInitializable} from "./interfaces/IInitializable.sol";
import {ContractStatus} from "./abstract/ContractStatus.sol";

contract Ask is INamed, IVersioned, ContractStatus, IInitializable {
    string private constant _NAME = "Ask";
    string private constant _VERSION = "1.0.0";

    uint256 public constant ASK_SCALING_FACTOR = 1e18;

    AskStorage public askStorage;
    ShardingTableStorage public shardingTableStorage;
    ParametersStorage public parametersStorage;
    ProfileStorage public profileStorage;
    StakingStorage public stakingStorage;

    // solhint-disable-next-line no-empty-blocks
    constructor(address hubAddress) ContractStatus(hubAddress) {}

    function initialize() public onlyHub {
        askStorage = AskStorage(hub.getContractAddress("AskStorage"));
        shardingTableStorage = ShardingTableStorage(hub.getContractAddress("ShardingTableStorage"));
        parametersStorage = ParametersStorage(hub.getContractAddress("ParametersStorage"));
        profileStorage = ProfileStorage(hub.getContractAddress("ProfileStorage"));
        stakingStorage = StakingStorage(hub.getContractAddress("StakingStorage"));
    }

    function name() public pure virtual returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual returns (string memory) {
        return _VERSION;
    }

    function recalculateActiveSet() external onlyContracts {
        AskStorage ass = askStorage;
        ShardingTableStorage sts = shardingTableStorage;
        StakingStorage ss = stakingStorage;
        ParametersStorage params = parametersStorage;
        ProfileStorage ps = profileStorage;

        ass.setPrevWeightedActiveAskSum(ass.weightedActiveAskSum());
        ass.setPrevTotalActiveStake(ass.totalActiveStake());

        uint96 minimumStake = params.minimumStake();
        uint96 maximumStake = params.maximumStake();

        uint256 askLowerBound;
        uint256 askUpperBound;

        if (ass.prevTotalActiveStake() > 0 && ass.prevWeightedActiveAskSum() > 0) {
            (askLowerBound, askUpperBound) = ass.getAskBounds();
        } else {
            (askLowerBound, askUpperBound) = (0, type(uint256).max);
        }

        uint256 newWeightedActiveAskSum;
        uint96 newTotalActiveStake;

        uint72 count = sts.nodesCount();
        for (uint72 i; i < count; i++) {
            uint72 nodeIdentityId = sts.indexToIdentityId(i);
            uint96 stake = ss.getNodeStake(nodeIdentityId);

            if (stake < minimumStake) {
                continue;
            }

            stake = stake > maximumStake ? maximumStake : stake;
            uint256 nodeAskScaled = uint256(ps.getAsk(nodeIdentityId)) * ASK_SCALING_FACTOR;
            if (nodeAskScaled >= askLowerBound && nodeAskScaled <= askUpperBound) {
                newWeightedActiveAskSum += (nodeAskScaled / ASK_SCALING_FACTOR) * stake;
                newTotalActiveStake += stake;
            }
        }

        ass.setWeightedActiveAskSum(newWeightedActiveAskSum);
        ass.setTotalActiveStake(newTotalActiveStake);
    }
}
