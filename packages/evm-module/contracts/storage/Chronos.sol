// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

contract Chronos {
    uint256 public immutable START_TIME;
    uint256 public immutable EPOCH_LENGTH;

    error InvalidStartTime();
    error InvalidEpochLength();

    constructor(uint256 _startTime, uint256 _epochLength) {
        if (_startTime <= 0) {
            revert InvalidStartTime();
        }
        if (_epochLength <= 0) {
            revert InvalidEpochLength();
        }

        START_TIME = _startTime;
        EPOCH_LENGTH = _epochLength;
    }

    function startTime() external view returns (uint256) {
        return START_TIME;
    }

    function epochLength() external view returns (uint256) {
        return EPOCH_LENGTH;
    }

    function getCurrentEpoch() external view returns (uint256) {
        if (block.timestamp < START_TIME) {
            return 1;
        }
        return ((block.timestamp - START_TIME) / EPOCH_LENGTH) + 1;
    }

    function epochAtTimestamp(uint256 timestamp) external view returns (uint256) {
        if (timestamp < START_TIME) {
            return 1;
        }
        return ((timestamp - START_TIME) / EPOCH_LENGTH) + 1;
    }

    function timeUntilNextEpoch() external view returns (uint256) {
        if (block.timestamp < START_TIME) {
            return START_TIME + EPOCH_LENGTH - block.timestamp;
        }
        uint256 elapsed = (block.timestamp - START_TIME) % EPOCH_LENGTH;
        return EPOCH_LENGTH - elapsed;
    }

    function hasEpochElapsed(uint256 epochNumber) external view returns (bool) {
        return block.timestamp >= (START_TIME + (epochNumber - 1) * EPOCH_LENGTH);
    }

    function timestampForEpoch(uint256 epochNumber) external view returns (uint256) {
        if (epochNumber == 0) {
            return 0;
        }
        return START_TIME + (epochNumber - 1) * EPOCH_LENGTH;
    }

    function elapsedTimeInCurrentEpoch() external view returns (uint256) {
        if (block.timestamp < START_TIME) {
            return 0;
        }
        return (block.timestamp - START_TIME) % EPOCH_LENGTH;
    }

    function totalElapsedTime() external view returns (uint256) {
        if (block.timestamp < START_TIME) {
            return 0;
        }
        return block.timestamp - START_TIME;
    }

    function isChronosActive() external view returns (bool) {
        return block.timestamp >= START_TIME;
    }
}
