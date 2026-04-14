// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

import {Chronos} from "./Chronos.sol";
import {HubDependent} from "../abstract/HubDependent.sol";
import {INamed} from "../interfaces/INamed.sol";
import {IVersioned} from "../interfaces/IVersioned.sol";

contract ConvictionStakingStorage is INamed, IVersioned, HubDependent {
    string private constant _NAME = "ConvictionStakingStorage";
    string private constant _VERSION = "1.0.0";

    struct Position {
        uint96 raw;
        uint40 lockEpochs;
        uint40 expiryEpoch;
        uint8 multiplier;
        uint72 identityId;
        uint256 lastClaimedEpoch;
    }

    event PositionCreated(
        uint256 indexed tokenId,
        uint72 indexed identityId,
        uint96 raw,
        uint40 lockEpochs,
        uint40 expiryEpoch,
        uint8 multiplier
    );
    event PositionRelocked(
        uint256 indexed tokenId,
        uint40 newLockEpochs,
        uint40 newExpiryEpoch,
        uint8 newMultiplier
    );
    event PositionRedelegated(
        uint256 indexed tokenId,
        uint72 indexed oldIdentityId,
        uint72 indexed newIdentityId
    );
    event PositionDeleted(uint256 indexed tokenId);
    event LastClaimedEpochUpdated(uint256 indexed tokenId, uint256 epoch);
    event EffectiveStakeFinalized(uint256 startEpoch, uint256 endEpoch);
    event NodeEffectiveStakeFinalized(uint72 indexed identityId, uint256 startEpoch, uint256 endEpoch);

    Chronos public chronos;

    mapping(uint256 => Position) public positions;

    mapping(uint256 => int256) public effectiveStakeDiff;
    mapping(uint256 => uint256) public totalEffectiveStakeAtEpoch;
    uint256 public lastFinalizedEpoch;

    mapping(uint72 => mapping(uint256 => int256)) public nodeEffectiveStakeDiff;
    mapping(uint72 => mapping(uint256 => uint256)) public nodeEffectiveStakeAtEpoch;
    mapping(uint72 => uint256) public nodeLastFinalizedEpoch;

    constructor(address hubAddress) HubDependent(hubAddress) {}

    function initialize() public onlyHub {
        chronos = Chronos(hub.getContractAddress("Chronos"));
    }

    function name() external pure virtual override returns (string memory) {
        return _NAME;
    }

    function version() external pure virtual override returns (string memory) {
        return _VERSION;
    }

    // ============================================================
    //                        Mutators
    // ============================================================

    function createPosition(
        uint256 tokenId,
        uint72 identityId,
        uint96 raw,
        uint40 lockEpochs,
        uint8 multiplier
    ) external onlyContracts {
        require(identityId != 0, "Zero node");
        require(positions[tokenId].raw == 0, "Position exists");
        require(raw > 0, "Zero raw");
        require(multiplier >= 1, "Bad multiplier");
        require(lockEpochs > 0 || multiplier == 1, "Lock0 must be 1x");

        uint256 currentEpoch = chronos.getCurrentEpoch();
        uint40 expiryEpoch = lockEpochs == 0 ? 0 : uint40(currentEpoch) + lockEpochs;

        positions[tokenId] = Position({
            raw: raw,
            lockEpochs: lockEpochs,
            expiryEpoch: expiryEpoch,
            multiplier: multiplier,
            identityId: identityId,
            lastClaimedEpoch: currentEpoch - 1
        });

        // Apply diff: full effective stake enters at currentEpoch
        int256 initialEffective = int256(uint256(raw)) * int256(uint256(multiplier));
        effectiveStakeDiff[currentEpoch] += initialEffective;
        nodeEffectiveStakeDiff[identityId][currentEpoch] += initialEffective;

        // On expiry, the multiplier boost drops away; principal remains at 1x
        if (lockEpochs > 0 && multiplier > 1) {
            int256 expiryDelta = int256(uint256(raw)) * int256(uint256(multiplier - 1));
            effectiveStakeDiff[expiryEpoch] -= expiryDelta;
            nodeEffectiveStakeDiff[identityId][expiryEpoch] -= expiryDelta;
        }

        if (currentEpoch > 1) {
            _finalizeEffectiveStakeUpTo(currentEpoch - 1);
            _finalizeNodeEffectiveStakeUpTo(identityId, currentEpoch - 1);
        }

        emit PositionCreated(tokenId, identityId, raw, lockEpochs, expiryEpoch, multiplier);
    }

    function updateOnRelock(
        uint256 tokenId,
        uint40 newLockEpochs,
        uint8 newMultiplier
    ) external onlyContracts {
        Position storage pos = positions[tokenId];
        require(pos.raw > 0, "No position");
        require(newLockEpochs > 0, "Zero lock");
        // 1x is the post-expiry rest state — re-committing at 1x would leave
        // lockEpochs/expiryEpoch non-zero while the diff curve stays flat,
        // a drift that downstream reward math cannot distinguish from a real
        // boosted lock. Force every relock to carry an actual multiplier.
        require(newMultiplier >= 2, "Bad multiplier");

        uint256 currentEpoch = chronos.getCurrentEpoch();
        // Relock is a post-expiry re-commit: prior lock must be done (or never existed)
        require(pos.expiryEpoch == 0 || currentEpoch >= pos.expiryEpoch, "Not expired");

        uint96 raw = pos.raw;
        uint72 identityId = pos.identityId;

        // Position is currently at raw*1 (permanent, post-expiry). Lift to raw*newMultiplier.
        int256 boost = int256(uint256(raw)) * int256(uint256(newMultiplier - 1));
        effectiveStakeDiff[currentEpoch] += boost;
        nodeEffectiveStakeDiff[identityId][currentEpoch] += boost;

        uint40 newExpiry = uint40(currentEpoch) + newLockEpochs;
        effectiveStakeDiff[newExpiry] -= boost;
        nodeEffectiveStakeDiff[identityId][newExpiry] -= boost;

        pos.expiryEpoch = newExpiry;
        pos.lockEpochs = newLockEpochs;
        pos.multiplier = newMultiplier;

        if (currentEpoch > 1) {
            _finalizeEffectiveStakeUpTo(currentEpoch - 1);
            _finalizeNodeEffectiveStakeUpTo(identityId, currentEpoch - 1);
        }

        emit PositionRelocked(tokenId, newLockEpochs, pos.expiryEpoch, newMultiplier);
    }

    function updateOnRedelegate(uint256 tokenId, uint72 newIdentityId) external onlyContracts {
        require(newIdentityId != 0, "Zero node");
        Position storage pos = positions[tokenId];
        require(pos.raw > 0, "No position");
        uint72 oldIdentityId = pos.identityId;
        require(oldIdentityId != newIdentityId, "Same node");

        uint256 currentEpoch = chronos.getCurrentEpoch();

        uint96 raw = pos.raw;
        uint40 expiryEpoch = pos.expiryEpoch;
        uint8 multiplier = pos.multiplier;
        bool stillBoosted = expiryEpoch != 0 && currentEpoch < expiryEpoch;

        // Effective stake contribution that must transfer per-node RIGHT NOW
        uint256 effectiveNow = stillBoosted ? uint256(raw) * uint256(multiplier) : uint256(raw);

        // Per-node diff move only; global totals unchanged
        int256 signedEffectiveNow = int256(effectiveNow);
        nodeEffectiveStakeDiff[oldIdentityId][currentEpoch] -= signedEffectiveNow;
        nodeEffectiveStakeDiff[newIdentityId][currentEpoch] += signedEffectiveNow;

        // Pending expiry drop must also follow the position
        if (stillBoosted) {
            int256 expiryDelta = int256(uint256(raw)) * int256(uint256(multiplier - 1));
            // cancel old subtraction
            nodeEffectiveStakeDiff[oldIdentityId][expiryEpoch] += expiryDelta;
            // install on new node
            nodeEffectiveStakeDiff[newIdentityId][expiryEpoch] -= expiryDelta;
        }

        pos.identityId = newIdentityId;

        if (currentEpoch > 1) {
            _finalizeNodeEffectiveStakeUpTo(oldIdentityId, currentEpoch - 1);
            _finalizeNodeEffectiveStakeUpTo(newIdentityId, currentEpoch - 1);
        }

        emit PositionRedelegated(tokenId, oldIdentityId, newIdentityId);
    }

    function setLastClaimedEpoch(uint256 tokenId, uint256 epoch) external onlyContracts {
        require(positions[tokenId].raw > 0, "No position");
        positions[tokenId].lastClaimedEpoch = epoch;
        emit LastClaimedEpochUpdated(tokenId, epoch);
    }

    function deletePosition(uint256 tokenId) external onlyContracts {
        Position memory pos = positions[tokenId];
        require(pos.raw > 0, "No position");

        uint256 currentEpoch = chronos.getCurrentEpoch();
        uint96 raw = pos.raw;
        uint72 identityId = pos.identityId;
        uint40 expiryEpoch = pos.expiryEpoch;
        uint8 multiplier = pos.multiplier;
        bool stillBoosted = expiryEpoch != 0 && currentEpoch < expiryEpoch;
        uint256 effectiveNow = stillBoosted ? uint256(raw) * uint256(multiplier) : uint256(raw);

        // Remove contribution from currentEpoch onward
        int256 signedEffectiveNow = int256(effectiveNow);
        effectiveStakeDiff[currentEpoch] -= signedEffectiveNow;
        nodeEffectiveStakeDiff[identityId][currentEpoch] -= signedEffectiveNow;

        // Cancel the pending expiry subtraction so it does not fire after delete
        if (stillBoosted) {
            int256 expiryDelta = int256(uint256(raw)) * int256(uint256(multiplier - 1));
            effectiveStakeDiff[expiryEpoch] += expiryDelta;
            nodeEffectiveStakeDiff[identityId][expiryEpoch] += expiryDelta;
        }

        delete positions[tokenId];

        if (currentEpoch > 1) {
            _finalizeEffectiveStakeUpTo(currentEpoch - 1);
            _finalizeNodeEffectiveStakeUpTo(identityId, currentEpoch - 1);
        }

        emit PositionDeleted(tokenId);
    }

    // ============================================================
    //                          Reads
    // ============================================================

    function getPosition(uint256 tokenId) external view returns (Position memory) {
        return positions[tokenId];
    }

    function getTotalEffectiveStakeAtEpoch(uint256 epoch) public view returns (uint256) {
        if (epoch <= lastFinalizedEpoch) {
            return totalEffectiveStakeAtEpoch[epoch];
        }
        int256 simulated = lastFinalizedEpoch > 0
            ? int256(totalEffectiveStakeAtEpoch[lastFinalizedEpoch])
            : int256(0);
        for (uint256 e = lastFinalizedEpoch + 1; e <= epoch; e++) {
            simulated += effectiveStakeDiff[e];
        }
        if (simulated < 0) return 0;
        return uint256(simulated);
    }

    function getNodeEffectiveStakeAtEpoch(uint72 identityId, uint256 epoch) public view returns (uint256) {
        uint256 lastFinalized = nodeLastFinalizedEpoch[identityId];
        if (epoch <= lastFinalized) {
            return nodeEffectiveStakeAtEpoch[identityId][epoch];
        }
        int256 simulated = lastFinalized > 0
            ? int256(nodeEffectiveStakeAtEpoch[identityId][lastFinalized])
            : int256(0);
        for (uint256 e = lastFinalized + 1; e <= epoch; e++) {
            simulated += nodeEffectiveStakeDiff[identityId][e];
        }
        if (simulated < 0) return 0;
        return uint256(simulated);
    }

    function getLastFinalizedEpoch() external view returns (uint256) {
        return lastFinalizedEpoch;
    }

    function getNodeLastFinalizedEpoch(uint72 identityId) external view returns (uint256) {
        return nodeLastFinalizedEpoch[identityId];
    }

    // ============================================================
    //                     External finalizers
    // ============================================================

    // Hub contracts (notably Phase 11 reward math) can amortize the
    // O(currentEpoch - lastFinalizedEpoch) simulate path into a single
    // write by calling these before reading getTotalEffectiveStakeAtEpoch /
    // getNodeEffectiveStakeAtEpoch across a long dormant window.

    function finalizeEffectiveStakeUpTo(uint256 epoch) external onlyContracts {
        _finalizeEffectiveStakeUpTo(epoch);
    }

    function finalizeNodeEffectiveStakeUpTo(uint72 identityId, uint256 epoch) external onlyContracts {
        _finalizeNodeEffectiveStakeUpTo(identityId, epoch);
    }

    // ============================================================
    //                       Internal finalize
    // ============================================================

    function _finalizeEffectiveStakeUpTo(uint256 epoch) internal {
        uint256 startEpoch = lastFinalizedEpoch + 1;
        if (startEpoch > epoch) return;
        for (uint256 e = startEpoch; e <= epoch; e++) {
            int256 prev = 0;
            if (e > 1) {
                prev = int256(totalEffectiveStakeAtEpoch[e - 1]);
            }
            int256 result = prev + effectiveStakeDiff[e];
            require(result >= 0, "Negative total");
            totalEffectiveStakeAtEpoch[e] = uint256(result);
        }
        lastFinalizedEpoch = epoch;

        emit EffectiveStakeFinalized(startEpoch, epoch);
    }

    function _finalizeNodeEffectiveStakeUpTo(uint72 identityId, uint256 epoch) internal {
        uint256 startEpoch = nodeLastFinalizedEpoch[identityId] + 1;
        if (startEpoch > epoch) return;
        for (uint256 e = startEpoch; e <= epoch; e++) {
            int256 prev = 0;
            if (e > 1) {
                prev = int256(nodeEffectiveStakeAtEpoch[identityId][e - 1]);
            }
            int256 result = prev + nodeEffectiveStakeDiff[identityId][e];
            require(result >= 0, "Negative node total");
            nodeEffectiveStakeAtEpoch[identityId][e] = uint256(result);
        }
        nodeLastFinalizedEpoch[identityId] = epoch;

        emit NodeEffectiveStakeFinalized(identityId, startEpoch, epoch);
    }
}
