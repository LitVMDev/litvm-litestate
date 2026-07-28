// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ------------------------------------------------------------
// Distribution
// ------------------------------------------------------------

enum DistributionMode {
    Automatic,
    ApprovalRequired
}

// Bounds every estate from a given factory must fall within. Set once per
// factory deployment and stored immutable on each estate, so production and
// testnet can differ without the contract ever branching on an environment
// flag at runtime.
struct EstateLimits {
    uint256 minHeartbeat;
    uint256 maxHeartbeat;
    uint256 minGrace;
    uint256 maxGrace;
    uint256 minApprovalWindow;
    uint256 maxApprovalWindow;
}

// The owner's own choices, validated against the EstateLimits above.
struct EstateSettings {
    uint256 heartbeatInterval;
    uint256 gracePeriod;
    DistributionMode mode;
}

// ------------------------------------------------------------
// Beneficiaries
// ------------------------------------------------------------

struct Beneficiary {
    uint256 id;
    address wallet;
    uint16 shareBps; // basis points; 10_000 = 100%
    bool active;
}

// ------------------------------------------------------------
// Approvers
// ------------------------------------------------------------

struct Approver {
    uint256 id;
    address wallet;
    bool approved;
    bool active;
}

// How many approvers must sign off before distribution unlocks.
// AnyOne and All track the live approver count, so removing an approver can
// never leave the requirement pointing at a number that can't be reached.
enum ApprovalRule {
    AnyOne,
    All,
    Threshold
}

struct ApprovalPolicy {
    ApprovalRule rule;
    uint8 threshold; // only read when rule == Threshold
    uint256 approvalWindow;
}
