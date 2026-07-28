// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import "../../src/Estate.sol";
import "../../src/EstateVault.sol";
import "../../src/Types.sol";
import "../../src/Errors.sol";

/// @dev A contract that always reverts on receiving ETH, used to force
/// low-level `.call` transfer failures (WithdrawalFailed / DistributionFailed).
contract RevertingReceiver {
    receive() external payable {
        revert("nope");
    }
}

abstract contract EstateTestBase is Test {
    address internal ownerAddr = makeAddr("owner");

    address internal ben1 = makeAddr("ben1");
    address internal ben2 = makeAddr("ben2");
    address internal ben3 = makeAddr("ben3");
    address internal residuary = makeAddr("residuary");

    address internal approver1 = makeAddr("approver1");
    address internal approver2 = makeAddr("approver2");
    address internal approver3 = makeAddr("approver3");

    address internal stranger = makeAddr("stranger");

    // Mirrors Estate's own platform constants (MIN_HEARTBEAT/MAX_HEARTBEAT/
    // MIN_GRACE/MAX_GRACE/MIN_APPROVAL_WINDOW/MAX_APPROVAL_WINDOW). Solidity
    // cannot read another contract's constant without an instance, so these
    // must be kept in sync with src/Estate.sol by hand.
    // Test limits mirror the production profile in script/DeployFactory.s.sol.
    // They are passed into every Estate rather than read from constants, since
    // limits are now per-factory immutables.
    function testLimits() internal pure returns (EstateLimits memory) {
        return EstateLimits({
            minHeartbeat: PLATFORM_MIN_HEARTBEAT,
            maxHeartbeat: PLATFORM_MAX_HEARTBEAT,
            minGrace: PLATFORM_MIN_GRACE,
            maxGrace: PLATFORM_MAX_GRACE,
            minApprovalWindow: PLATFORM_MIN_APPROVAL_WINDOW,
            maxApprovalWindow: PLATFORM_MAX_APPROVAL_WINDOW
        });
    }

    uint256 internal constant PLATFORM_MIN_HEARTBEAT = 30 days;
    uint256 internal constant PLATFORM_MAX_HEARTBEAT = 5 * 365 days;
    uint256 internal constant PLATFORM_MIN_GRACE = 7 days;
    uint256 internal constant PLATFORM_MAX_GRACE = 365 days;
    uint256 internal constant PLATFORM_MIN_APPROVAL_WINDOW = 7 days;
    uint256 internal constant PLATFORM_MAX_APPROVAL_WINDOW = 365 days;
    uint8 internal constant PLATFORM_MAX_APPROVERS = 5;

    uint256 internal constant HEARTBEAT = PLATFORM_MIN_HEARTBEAT;
    uint256 internal constant GRACE = PLATFORM_MIN_GRACE;
    uint256 internal constant APPROVAL_WINDOW = 30 days;

    function defaultSettings(DistributionMode mode) internal pure returns (EstateSettings memory) {
        return EstateSettings({heartbeatInterval: HEARTBEAT, gracePeriod: GRACE, mode: mode});
    }

    /// @dev `requiredApprovals` is expressed as a Threshold rule so tests can
    /// pin an exact quorum. Automatic estates get a placeholder policy, which
    /// the constructor does not validate.
    function defaultPolicy(uint8 requiredApprovals) internal pure returns (ApprovalPolicy memory) {
        return
            ApprovalPolicy({
                rule: ApprovalRule.Threshold, threshold: requiredApprovals, approvalWindow: APPROVAL_WINDOW
            });
    }

    function policyOf(ApprovalRule rule) internal pure returns (ApprovalPolicy memory) {
        return ApprovalPolicy({rule: rule, threshold: 0, approvalWindow: APPROVAL_WINDOW});
    }

    function policyFor(DistributionMode mode, uint8 requiredApprovals) internal pure returns (ApprovalPolicy memory) {
        if (mode == DistributionMode.Automatic) {
            return policyOf(ApprovalRule.AnyOne);
        }

        return defaultPolicy(requiredApprovals);
    }

    function deployEstate(address asOwner, DistributionMode mode, uint8 requiredApprovals)
        internal
        returns (Estate estate)
    {
        estate = new Estate(asOwner, defaultSettings(mode), policyFor(mode, requiredApprovals), testLimits());
    }

    function deployEstate(DistributionMode mode, uint8 requiredApprovals) internal returns (Estate estate) {
        return deployEstate(ownerAddr, mode, requiredApprovals);
    }

    function deployEstateWithVault(address asOwner, DistributionMode mode, uint8 requiredApprovals)
        internal
        returns (Estate estate, EstateVault vault)
    {
        estate = deployEstate(asOwner, mode, requiredApprovals);
        vault = new EstateVault(address(estate));

        vm.prank(asOwner);
        estate.setVault(address(vault));
    }

    function deployEstateWithVault(DistributionMode mode, uint8 requiredApprovals)
        internal
        returns (Estate estate, EstateVault vault)
    {
        return deployEstateWithVault(ownerAddr, mode, requiredApprovals);
    }

    function warpPastHeartbeat() internal {
        vm.warp(block.timestamp + HEARTBEAT + 1);
    }

    function warpPastGrace() internal {
        vm.warp(block.timestamp + HEARTBEAT + GRACE + 1);
    }

    function warpPastApprovalWindow() internal {
        vm.warp(block.timestamp + HEARTBEAT + GRACE + APPROVAL_WINDOW + 1);
    }
}
