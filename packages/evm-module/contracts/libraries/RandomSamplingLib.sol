// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.20;

library RandomSamplingLib {
    struct Challenge {
        uint256 knowledgeCollectionId;
        uint256 chunkId; // TODO:Smaller data structure
        address knowledgeCollectionStorageContract;
        uint256 epoch;
        uint256 activeProofPeriodStartBlock;
        uint256 proofingPeriodDurationInBlocks;
        bool solved;
    }

    struct ProofPeriodStatus {
        uint256 activeProofPeriodStartBlock;
        bool isValid;
    }

    struct ProofingPeriodDuration {
        uint16 durationInBlocks;
        uint256 effectiveEpoch;
    }
}
