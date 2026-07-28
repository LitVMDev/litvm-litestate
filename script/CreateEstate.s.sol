// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import "../src/Estate.sol";
import "../src/EstateFactory.sol";
import "../src/Types.sol";

/// Creates ONE user's estate through an already-deployed factory.
///
/// This is a convenience wrapper for CLI/testnet use - in production the front
/// end calls factory.createEstate() directly with the user's own choices. Every
/// value here is a per-user preference, which is why they are read from the
/// environment rather than hardcoded.
///
///   FACTORY           address of the deployed EstateFactory   (required)
///   HEARTBEAT_DAYS    days between required check-ins         (default 180)
///   GRACE_DAYS        days of grace after a missed check-in   (default 30)
///   APPROVAL_MODE     0 = Automatic, 1 = ApprovalRequired     (default 1)
///   APPROVAL_RULE     0 = AnyOne, 1 = All, 2 = Threshold      (default 0)
///   APPROVAL_THRESHOLD  required approvals when rule == 2     (default 0)
///   APPROVAL_WINDOW_DAYS  days approvers have to act          (default 30)
contract CreateEstate is Script {
    function run() external {
        address factoryAddress = vm.envAddress("FACTORY");

        uint256 heartbeatDays = vm.envOr("HEARTBEAT_DAYS", uint256(180));
        uint256 graceDays = vm.envOr("GRACE_DAYS", uint256(30));
        uint256 approvalMode = vm.envOr("APPROVAL_MODE", uint256(1));
        uint256 approvalRule = vm.envOr("APPROVAL_RULE", uint256(0));
        uint256 threshold = vm.envOr("APPROVAL_THRESHOLD", uint256(0));
        uint256 windowDays = vm.envOr("APPROVAL_WINDOW_DAYS", uint256(30));

        EstateSettings memory settings = EstateSettings({
            heartbeatInterval: heartbeatDays * 1 days,
            gracePeriod: graceDays * 1 days,
            mode: DistributionMode(approvalMode)
        });

        ApprovalPolicy memory approvalPolicy = ApprovalPolicy({
            rule: ApprovalRule(approvalRule), threshold: uint8(threshold), approvalWindow: windowDays * 1 days
        });

        vm.startBroadcast();

        (address estate, address vault) = EstateFactory(factoryAddress).createEstate(settings, approvalPolicy);

        vm.stopBroadcast();

        console2.log("");
        console2.log("====================================");
        console2.log("Estate Created");
        console2.log("====================================");
        console2.log("Estate:");
        console2.log(estate);
        console2.log("");
        console2.log("Vault:");
        console2.log(vault);
        console2.log("====================================");
        console2.log("");
        console2.log("REQUIRED before the vault will accept any deposit:");
        console2.log("  1. addApprover(...) - enough to satisfy the approval");
        console2.log("     rule (AnyOne needs 1; Threshold needs its full N).");
        console2.log("  2. addBeneficiary(...) and/or");
        console2.log("     setResiduaryBeneficiary(...) - at least one recipient.");
        console2.log("");
        console2.log("  Deposits revert until isFullyConfigured() is true, and");
        console2.log("  none of the above can be changed once the heartbeat");
        console2.log("  lapses.");
        console2.log("====================================");
    }
}
