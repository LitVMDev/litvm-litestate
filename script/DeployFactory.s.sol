// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

import "../src/EstateFactory.sol";
import "../src/Types.sol";

/// Production limits: the periods a real estate plan should run on.
library ProductionLimits {
    function get() internal pure returns (EstateLimits memory) {
        return EstateLimits({
            minHeartbeat: 30 days,
            maxHeartbeat: 5 * 365 days,
            minGrace: 7 days,
            maxGrace: 365 days,
            minApprovalWindow: 7 days,
            maxApprovalWindow: 365 days
        });
    }
}

/// Testnet limits: everything can drop to a single day so a full lifecycle
/// can be exercised without waiting a month. Identical contract code - only
/// these constructor values differ.
library TestnetLimits {
    function get() internal pure returns (EstateLimits memory) {
        return EstateLimits({
            minHeartbeat: 1 days,
            maxHeartbeat: 5 * 365 days,
            minGrace: 1 days,
            maxGrace: 365 days,
            minApprovalWindow: 1 days,
            maxApprovalWindow: 365 days
        });
    }
}

/// Deploys the platform with production limits. Run once per chain.
///
/// Carries no estate configuration: heartbeat interval, grace period,
/// distribution mode and approval policy are per-user choices made at
/// createEstate() time. What this script does fix is the *bounds* those
/// choices must fall within, which are shared by every estate this factory
/// creates.
contract DeployFactory is Script {
    function run() external {
        vm.startBroadcast();
        EstateFactory factory = new EstateFactory(ProductionLimits.get());
        vm.stopBroadcast();

        _report("production", address(factory), ProductionLimits.get());
    }
}

/// Deploys the platform with relaxed testnet limits.
contract DeployFactoryTestnet is Script {
    function run() external {
        vm.startBroadcast();
        EstateFactory factory = new EstateFactory(TestnetLimits.get());
        vm.stopBroadcast();

        _report("testnet", address(factory), TestnetLimits.get());
    }
}

function _report(string memory kind, address factory, EstateLimits memory l) view {
    console2.log("");
    console2.log("====================================");
    console2.log("LitEstate Platform Deployed");
    console2.log("====================================");
    console2.log("Limits profile:");
    console2.log(kind);
    console2.log("EstateFactory:");
    console2.log(factory);
    console2.log("------------------------------------");
    console2.log("Check-in interval (days), min / max:");
    console2.log(l.minHeartbeat / 1 days);
    console2.log(l.maxHeartbeat / 1 days);
    console2.log("Grace period (days), min / max:");
    console2.log(l.minGrace / 1 days);
    console2.log(l.maxGrace / 1 days);
    console2.log("Approval window (days), min / max:");
    console2.log(l.minApprovalWindow / 1 days);
    console2.log(l.maxApprovalWindow / 1 days);
    console2.log("====================================");
    console2.log("");
    console2.log("Users create their own estates with:");
    console2.log("  factory.createEstate(settings, approvalPolicy)");
    console2.log("====================================");
}
