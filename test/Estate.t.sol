// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./helpers/EstateTestBase.sol";

contract EstateConstructorTest is EstateTestBase {
    function test_ConstructorSetsInitialState() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        assertEq(estate.owner(), ownerAddr);
        assertEq(estate.lastCheckIn(), block.timestamp);
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
        assertEq(estate.totalAllocatedBps(), 0);
    }

    function test_ConstructorRevertsWhenHeartbeatBelowMin() public {
        EstateSettings memory settings = defaultSettings(DistributionMode.Automatic);
        settings.heartbeatInterval = PLATFORM_MIN_HEARTBEAT - 1;

        vm.expectRevert(InvalidHeartbeat.selector);
        new Estate(ownerAddr, settings, policyOf(ApprovalRule.AnyOne), testLimits());
    }

    function test_ConstructorRevertsWhenHeartbeatAboveMax() public {
        EstateSettings memory settings = defaultSettings(DistributionMode.Automatic);
        settings.heartbeatInterval = PLATFORM_MAX_HEARTBEAT + 1;

        vm.expectRevert(InvalidHeartbeat.selector);
        new Estate(ownerAddr, settings, policyOf(ApprovalRule.AnyOne), testLimits());
    }

    function test_ConstructorRevertsWhenGraceBelowMin() public {
        EstateSettings memory settings = defaultSettings(DistributionMode.Automatic);
        settings.gracePeriod = PLATFORM_MIN_GRACE - 1;

        vm.expectRevert(InvalidGracePeriod.selector);
        new Estate(ownerAddr, settings, policyOf(ApprovalRule.AnyOne), testLimits());
    }

    function test_ConstructorRevertsWhenGraceAboveMax() public {
        EstateSettings memory settings = defaultSettings(DistributionMode.Automatic);
        settings.gracePeriod = PLATFORM_MAX_GRACE + 1;

        vm.expectRevert(InvalidGracePeriod.selector);
        new Estate(ownerAddr, settings, policyOf(ApprovalRule.AnyOne), testLimits());
    }

    function test_ConstructorAcceptsBoundaryHeartbeatAndGrace() public {
        EstateSettings memory settings = EstateSettings({
            heartbeatInterval: PLATFORM_MIN_HEARTBEAT, gracePeriod: PLATFORM_MIN_GRACE, mode: DistributionMode.Automatic
        });

        Estate estate = new Estate(ownerAddr, settings, policyOf(ApprovalRule.AnyOne), testLimits());
        assertEq(estate.heartbeatExpiresAt(), block.timestamp + PLATFORM_MIN_HEARTBEAT);
    }

    function test_ConstructorRevertsOnApprovalWindowOutOfRange() public {
        EstateSettings memory settings = defaultSettings(DistributionMode.ApprovalRequired);

        ApprovalPolicy memory tooShort = policyOf(ApprovalRule.AnyOne);
        tooShort.approvalWindow = PLATFORM_MIN_APPROVAL_WINDOW - 1;

        vm.expectRevert(InvalidApprovalWindow.selector);
        new Estate(ownerAddr, settings, tooShort, testLimits());

        ApprovalPolicy memory tooLong = policyOf(ApprovalRule.AnyOne);
        tooLong.approvalWindow = PLATFORM_MAX_APPROVAL_WINDOW + 1;

        vm.expectRevert(InvalidApprovalWindow.selector);
        new Estate(ownerAddr, settings, tooLong, testLimits());
    }

    function test_ConstructorRevertsOnZeroThreshold() public {
        vm.expectRevert(InvalidApprovalPolicy.selector);
        new Estate(ownerAddr, defaultSettings(DistributionMode.ApprovalRequired), defaultPolicy(0), testLimits());
    }

    function test_ConstructorRevertsOnThresholdAboveMaxApprovers() public {
        vm.expectRevert(InvalidApprovalPolicy.selector);
        new Estate(
            ownerAddr,
            defaultSettings(DistributionMode.ApprovalRequired),
            defaultPolicy(PLATFORM_MAX_APPROVERS + 1),
            testLimits()
        );
    }

    function test_ConstructorIgnoresApprovalPolicyWhenAutomatic() public {
        // Automatic estates never consult the policy, so an otherwise invalid
        // one must not block deployment.
        ApprovalPolicy memory unusable = ApprovalPolicy({rule: ApprovalRule.Threshold, threshold: 0, approvalWindow: 0});

        Estate estate = new Estate(ownerAddr, defaultSettings(DistributionMode.Automatic), unusable, testLimits());

        assertEq(estate.requiredApprovals(), 0);
    }
}

contract EstateOwnerPermissionsTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        estate = deployEstate(DistributionMode.ApprovalRequired, 1);
    }

    function test_NonOwnerCannotCheckIn() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.checkIn();
    }

    function test_NonOwnerCannotAddBeneficiary() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.addBeneficiary(ben1, 5000);
    }

    function test_NonOwnerCannotRemoveBeneficiary() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);

        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.removeBeneficiary(1);
    }

    function test_NonOwnerCannotUpdateBeneficiary() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);

        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.updateBeneficiary(1, 6000);
    }

    function test_NonOwnerCannotAddApprover() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.addApprover(approver1);
    }

    function test_NonOwnerCannotRemoveApprover() public {
        vm.prank(ownerAddr);
        estate.addApprover(approver1);

        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.removeApprover(1);
    }

    function test_NonOwnerCannotUpdateHeartbeat() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.updateHeartbeat(10 days);
    }

    function test_NonOwnerCannotUpdateGracePeriod() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.updateGracePeriod(3 days);
    }

    function test_NonOwnerCannotSetResiduaryBeneficiary() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.setResiduaryBeneficiary(residuary);
    }

    function test_NonOwnerCannotSetVault() public {
        EstateVault vault = new EstateVault(address(estate));

        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        estate.setVault(address(vault));
    }

    function test_OwnerCanCallOwnerFunctions() public {
        vm.startPrank(ownerAddr);
        estate.checkIn();
        estate.addBeneficiary(ben1, 5000);
        estate.updateBeneficiary(1, 6000);
        estate.removeBeneficiary(1);
        estate.addApprover(approver1);
        estate.addApprover(approver2); // spare capacity so removal below doesn't break the required-approvals=1 policy
        estate.removeApprover(1);
        estate.updateHeartbeat(60 days);
        estate.updateGracePeriod(10 days);
        estate.setResiduaryBeneficiary(residuary);
        vm.stopPrank();
    }
}

contract EstateBeneficiaryManagementTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        estate = deployEstate(DistributionMode.Automatic, 0);
    }

    function test_AddBeneficiarySucceeds() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 4000);

        Beneficiary memory b = estate.getBeneficiary(1);
        assertEq(b.id, 1);
        assertEq(b.wallet, ben1);
        assertEq(b.shareBps, 4000);
        assertTrue(b.active);

        assertEq(estate.totalAllocatedBps(), 4000);
        assertEq(estate.beneficiaryCount(), 1);
        assertEq(estate.getBeneficiaryIds().length, 1);
        assertEq(estate.getBeneficiaryIds()[0], 1);
    }

    function test_AddBeneficiaryRevertsOnZeroAddress() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidBeneficiary.selector);
        estate.addBeneficiary(address(0), 5000);
    }

    function test_AddBeneficiaryRevertsOnZeroShare() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidBeneficiary.selector);
        estate.addBeneficiary(ben1, 0);
    }

    function test_AddBeneficiaryRevertsOnDuplicateWallet() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3000);

        vm.expectRevert(DuplicateBeneficiary.selector);
        estate.addBeneficiary(ben1, 2000);
        vm.stopPrank();
    }

    function test_AddBeneficiaryRevertsWhenWalletIsOwner() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidBeneficiary.selector);
        estate.addBeneficiary(ownerAddr, 5000);
    }

    function test_SetResiduaryBeneficiaryRevertsWhenWalletIsOwner() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidBeneficiary.selector);
        estate.setResiduaryBeneficiary(ownerAddr);
    }

    function test_SetResiduaryBeneficiarySucceedsAndClears() public {
        vm.startPrank(ownerAddr);
        estate.setResiduaryBeneficiary(residuary);
        assertEq(estate.residuaryBeneficiary(), residuary);

        estate.setResiduaryBeneficiary(address(0));
        assertEq(estate.residuaryBeneficiary(), address(0));
        vm.stopPrank();
    }

    function test_AddBeneficiaryRevertsAfterHeartbeatExpired() public {
        warpPastHeartbeat();

        vm.prank(ownerAddr);
        vm.expectRevert(HeartbeatExpired.selector);
        estate.addBeneficiary(ben1, 5000);
    }

    function test_UpdateBeneficiarySucceeds() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3000);
        estate.updateBeneficiary(1, 5000);
        vm.stopPrank();

        assertEq(estate.getBeneficiary(1).shareBps, 5000);
        assertEq(estate.totalAllocatedBps(), 5000);
    }

    function test_UpdateBeneficiaryRevertsOnZeroShare() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3000);

        vm.expectRevert(InvalidBeneficiary.selector);
        estate.updateBeneficiary(1, 0);
        vm.stopPrank();
    }

    function test_UpdateBeneficiaryRevertsOnNonexistentId() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidBeneficiary.selector);
        estate.updateBeneficiary(999, 5000);
    }

    function test_UpdateBeneficiaryRevertsOnRemovedId() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3000);
        estate.removeBeneficiary(1);

        vm.expectRevert(InvalidBeneficiary.selector);
        estate.updateBeneficiary(1, 5000);
        vm.stopPrank();
    }

    function test_UpdateBeneficiaryRevertsWhenExceeding100Percent() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3000);
        estate.addBeneficiary(ben2, 3000);

        vm.expectRevert(AllocationExceeds100Percent.selector);
        estate.updateBeneficiary(1, 8000);
        vm.stopPrank();
    }

    function test_UpdateBeneficiaryAllowsExactly100PercentBoundary() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.addBeneficiary(ben2, 3000);

        estate.updateBeneficiary(1, 7000); // 7000 + 3000 = 10000, exactly at cap
        vm.stopPrank();

        assertEq(estate.totalAllocatedBps(), 10_000);
    }

    function test_RemoveBeneficiarySucceeds() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.removeBeneficiary(1);
        vm.stopPrank();

        assertFalse(estate.getBeneficiary(1).active);
        assertEq(estate.totalAllocatedBps(), 0);
        assertEq(estate.beneficiaryCount(), 0);
    }

    function test_RemoveBeneficiaryAllowsWalletReuse() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.removeBeneficiary(1);
        estate.addBeneficiary(ben1, 3000);
        vm.stopPrank();

        Beneficiary memory b = estate.getBeneficiary(2);
        assertEq(b.wallet, ben1);
        assertEq(b.shareBps, 3000);
        assertEq(estate.totalAllocatedBps(), 3000);
    }

    function test_RemoveBeneficiaryRevertsOnNonexistentId() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidBeneficiary.selector);
        estate.removeBeneficiary(999);
    }

    function test_RemoveBeneficiaryRevertsOnDoubleRemove() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.removeBeneficiary(1);

        vm.expectRevert(InvalidBeneficiary.selector);
        estate.removeBeneficiary(1);
        vm.stopPrank();
    }

    function test_RemoveBeneficiaryRevertsAfterHeartbeatExpired() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);

        warpPastHeartbeat();

        vm.prank(ownerAddr);
        vm.expectRevert(HeartbeatExpired.selector);
        estate.removeBeneficiary(1);
    }
}

contract EstateAllocationLimitsTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        estate = deployEstate(DistributionMode.Automatic, 0);
    }

    function test_AllocationUpToExactly100PercentSucceeds() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 4000);
        estate.addBeneficiary(ben2, 4000);
        estate.addBeneficiary(ben3, 2000);
        vm.stopPrank();

        assertEq(estate.totalAllocatedBps(), 10_000);
    }

    function test_AllocationExceeding100PercentReverts() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 6000);

        vm.expectRevert(AllocationExceeds100Percent.selector);
        estate.addBeneficiary(ben2, 4001);
        vm.stopPrank();
    }

    function test_AllocationExactlyAtBoundarySucceeds() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 6000);
        estate.addBeneficiary(ben2, 4000);
        vm.stopPrank();

        assertEq(estate.totalAllocatedBps(), 10_000);
    }
}

contract EstateApproverManagementTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        estate = deployEstate(DistributionMode.ApprovalRequired, 1);
    }

    function test_AddApproverSucceeds() public {
        vm.prank(ownerAddr);
        estate.addApprover(approver1);

        Approver memory a = estate.getApprover(1);
        assertEq(a.id, 1);
        assertEq(a.wallet, approver1);
        assertFalse(a.approved);
        assertTrue(a.active);
        assertEq(estate.approverCount(), 1);
    }

    function test_AddApproverRevertsOnZeroAddress() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidApprover.selector);
        estate.addApprover(address(0));
    }

    function test_AddApproverRevertsOnDuplicate() public {
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);

        vm.expectRevert(DuplicateApprover.selector);
        estate.addApprover(approver1);
        vm.stopPrank();
    }

    function test_AddApproverRevertsAfterHeartbeatExpired() public {
        warpPastHeartbeat();

        vm.prank(ownerAddr);
        vm.expectRevert(HeartbeatExpired.selector);
        estate.addApprover(approver1);
    }

    function test_RemoveApproverSucceeds() public {
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        estate.removeApprover(1);
        vm.stopPrank();

        assertFalse(estate.getApprover(1).active);
        assertEq(estate.approverCount(), 1); // active only, matching beneficiaryCount()
        assertEq(estate.activeApproverCount(), 1);
        assertEq(estate.getApproverIds().length, 2); // historical ids remain available
    }

    function test_ActiveApproverCountTracksAddAndRemove() public {
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        assertEq(estate.activeApproverCount(), 2);

        estate.removeApprover(1);
        assertEq(estate.activeApproverCount(), 1);
        vm.stopPrank();
    }

    function test_RemoveApproverRevertsOnNonexistentId() public {
        vm.prank(ownerAddr);
        vm.expectRevert(NotApprover.selector);
        estate.removeApprover(999);
    }

    function test_RemoveApproverRevertsOnDoubleRemove() public {
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        estate.removeApprover(1);

        vm.expectRevert(NotApprover.selector);
        estate.removeApprover(1);
        vm.stopPrank();
    }

    function test_RemoveApproverRevertsWhenBreaksApprovalPolicy() public {
        // requiredApprovals == 1 and only one approver exists
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);

        vm.expectRevert(InvalidApprovalPolicy.selector);
        estate.removeApprover(1);
        vm.stopPrank();
    }

    function test_RemoveApproverAllowedWhenSpareCapacityRemains() public {
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        estate.removeApprover(1);
        vm.stopPrank();

        assertFalse(estate.getApprover(1).active);
    }

    function test_RemoveApproverIsAlwaysBlockedOnceApprovalIsPossible() public {
        // removeApprover() is gated by onlyWhileActive (blocks once heartbeat
        // has expired), while approveDistribution() only succeeds once grace
        // has *also* expired (a strictly later point in time). So the
        // `if (approver.approved) approvalCount--;` cleanup branch inside
        // removeApprover() can never actually execute - this pins that.
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        vm.stopPrank();

        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();
        assertEq(estate.approvalCount(), 1);

        vm.prank(ownerAddr);
        vm.expectRevert(HeartbeatExpired.selector);
        estate.removeApprover(1);
    }
}

contract EstateHeartbeatAndGraceTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        estate = deployEstate(DistributionMode.ApprovalRequired, 1);
        vm.prank(ownerAddr);
        estate.addApprover(approver1);
    }

    function test_HeartbeatNotExpiredInitially() public view {
        assertFalse(estate.heartbeatExpired());
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
    }

    function test_HeartbeatExpiredAfterInterval() public {
        warpPastHeartbeat();
        assertTrue(estate.heartbeatExpired());
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.GracePeriod));
    }

    function test_CheckInResetsLastCheckIn() public {
        vm.warp(block.timestamp + 5 days);

        vm.prank(ownerAddr);
        estate.checkIn();

        assertEq(estate.lastCheckIn(), block.timestamp);
        assertFalse(estate.heartbeatExpired());
    }

    function test_CheckInEmitsCheckedIn() public {
        vm.warp(block.timestamp + 5 days);

        vm.expectEmit(true, false, false, true, address(estate));
        emit Estate.CheckedIn(ownerAddr, block.timestamp);

        vm.prank(ownerAddr);
        estate.checkIn();
    }

    function test_CheckInAllowedDuringGracePeriod() public {
        vm.warp(block.timestamp + HEARTBEAT + 1); // heartbeat expired, still in grace
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.GracePeriod));

        vm.prank(ownerAddr);
        estate.checkIn();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
    }

    function test_CheckInRevertsAfterGraceExpired() public {
        warpPastGrace();

        vm.prank(ownerAddr);
        vm.expectRevert(DistributionNotReady.selector);
        estate.checkIn();
    }

    function test_ApprovalCountCannotBeNonZeroWhileCheckInIsStillAllowed() public {
        // approveDistribution() only succeeds once getState() == AwaitingApproval,
        // which requires graceExpired() == true. checkIn() only succeeds while
        // graceExpired() == false. Since graceExpired() is monotonic (time only
        // moves forward), no approval can ever be recorded before grace expiry
        // permanently blocks checkIn() - so the "reset approvals" loop inside
        // checkIn() can never actually fire. This test pins that behavior.
        vm.prank(ownerAddr);
        estate.addApprover(approver2);

        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();
        assertEq(estate.approvalCount(), 1);

        vm.prank(ownerAddr);
        vm.expectRevert(DistributionNotReady.selector);
        estate.checkIn();
    }

    function test_GraceEndsAtAndHeartbeatExpiresAtMath() public view {
        assertEq(estate.heartbeatExpiresAt(), block.timestamp + HEARTBEAT);
        assertEq(estate.graceEndsAt(), block.timestamp + HEARTBEAT + GRACE);
    }

    function test_GraceExpiredFalseDuringGrace() public {
        vm.warp(block.timestamp + HEARTBEAT + 1);
        assertFalse(estate.graceExpired());
    }

    function test_GraceExpiredTrueAfterGrace() public {
        warpPastGrace();
        assertTrue(estate.graceExpired());
    }

    function test_UpdateHeartbeatRevertsOutOfRange() public {
        vm.startPrank(ownerAddr);
        vm.expectRevert(InvalidHeartbeat.selector);
        estate.updateHeartbeat(PLATFORM_MAX_HEARTBEAT + 1);

        vm.expectRevert(InvalidHeartbeat.selector);
        estate.updateHeartbeat(PLATFORM_MIN_HEARTBEAT - 1);
        vm.stopPrank();
    }

    function test_UpdateHeartbeatRevertsAfterExpired() public {
        warpPastHeartbeat();

        vm.prank(ownerAddr);
        vm.expectRevert(HeartbeatExpired.selector);
        estate.updateHeartbeat(10 days);
    }

    function test_UpdateGracePeriodRevertsOutOfRange() public {
        vm.startPrank(ownerAddr);
        vm.expectRevert(InvalidGracePeriod.selector);
        estate.updateGracePeriod(PLATFORM_MAX_GRACE + 1);

        vm.expectRevert(InvalidGracePeriod.selector);
        estate.updateGracePeriod(PLATFORM_MIN_GRACE - 1);
        vm.stopPrank();
    }

    function test_UpdateGracePeriodSucceeds() public {
        vm.prank(ownerAddr);
        estate.updateGracePeriod(10 days);

        assertEq(estate.graceEndsAt(), estate.heartbeatExpiresAt() + 10 days);
    }
}

contract EstateAutomaticDistributionTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        // Linked to a vault: canDistribute() reports false without one.
        (estate,) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
    }

    function test_ReadyForDistributionAssoonAsGraceExpires() public {
        warpPastGrace();
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.ReadyForDistribution));
        assertTrue(estate.canDistribute());
    }

    function test_NotReadyDuringGracePeriod() public {
        vm.warp(block.timestamp + HEARTBEAT + 1);
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.GracePeriod));
        assertFalse(estate.canDistribute());
    }

    function test_CanDistributeFalseWhenVaultUnset() public {
        Estate unlinked = deployEstate(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        unlinked.addBeneficiary(ben1, 10_000);

        warpPastGrace();

        // getState() is ready, but with no vault linked the estate reports
        // honestly rather than failing later inside distribute().
        assertEq(uint8(unlinked.getState()), uint8(Estate.EstateState.ReadyForDistribution));
        assertFalse(unlinked.canDistribute());
    }
}

contract EstateApprovalRequiredDistributionTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        // Linked to a vault: canDistribute() reports false without one.
        (estate,) = deployEstateWithVault(DistributionMode.ApprovalRequired, 2);
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        vm.stopPrank();
    }

    function test_AwaitingApprovalOnceGraceExpires() public {
        warpPastGrace();
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));
        assertFalse(estate.canDistribute());
    }

    function test_ApproveDistributionRevertsForNonApprover() public {
        warpPastGrace();

        vm.prank(stranger);
        vm.expectRevert(NotApprover.selector);
        estate.approveDistribution();
    }

    function test_ApproveDistributionRevertsBeforeAwaitingApproval() public {
        vm.prank(approver1);
        vm.expectRevert(ApprovalRequired.selector);
        estate.approveDistribution();
    }

    function test_ApproveDistributionSucceeds() public {
        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();

        assertTrue(estate.getApprover(1).approved);
        assertEq(estate.approvalCount(), 1);
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));
    }

    function test_ReadyForDistributionOnceQuorumReached() public {
        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();
        vm.prank(approver2);
        estate.approveDistribution();

        assertEq(estate.approvalCount(), 2);
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.ReadyForDistribution));
        assertTrue(estate.canDistribute());
    }

    function test_ApproveDistributionRevertsAfterApprovalWindowExpires() public {
        warpPastApprovalWindow();

        vm.prank(approver1);
        vm.expectRevert(ApprovalWindowExpired.selector);
        estate.approveDistribution();
    }

    function test_StuckAwaitingApprovalForeverIfWindowExpiresWithoutQuorum() public {
        warpPastApprovalWindow();

        // No recovery path: checkIn is blocked (grace already expired),
        // approving is blocked (window expired) -> state is permanently stuck.
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));

        vm.prank(ownerAddr);
        vm.expectRevert(DistributionNotReady.selector);
        estate.checkIn();
    }
}

contract EstateDuplicateApprovalsTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        // requiredApprovals = 2 so a single approval doesn't already flip the
        // estate to ReadyForDistribution (which would mask AlreadyApproved
        // behind an ApprovalRequired revert instead).
        estate = deployEstate(DistributionMode.ApprovalRequired, 2);
        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        vm.stopPrank();
    }

    function test_ApproverCannotApproveTwice() public {
        warpPastGrace();

        vm.startPrank(approver1);
        estate.approveDistribution();

        vm.expectRevert(AlreadyApproved.selector);
        estate.approveDistribution();
        vm.stopPrank();
    }

    function test_ReapprovalAfterRemoveAndReAddIsFresh() public {
        vm.startPrank(ownerAddr);
        estate.addApprover(approver3); // spare capacity so removing approver1 keeps quorum satisfiable
        estate.removeApprover(1);
        estate.addApprover(approver1); // re-add same wallet as a new id
        vm.stopPrank();

        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();

        assertEq(estate.approvalCount(), 1);
    }
}

contract EstateVaultLinkingTest is EstateTestBase {
    Estate internal estate;

    function setUp() public {
        estate = deployEstate(DistributionMode.Automatic, 0);
    }

    function test_SetVaultSucceeds() public {
        EstateVault vault = new EstateVault(address(estate));

        vm.prank(ownerAddr);
        estate.setVault(address(vault));

        assertEq(estate.vault(), address(vault));
    }

    function test_SetVaultRevertsOnSecondCall() public {
        EstateVault vault1 = new EstateVault(address(estate));
        EstateVault vault2 = new EstateVault(address(estate));

        vm.startPrank(ownerAddr);
        estate.setVault(address(vault1));

        vm.expectRevert(VaultAlreadySet.selector);
        estate.setVault(address(vault2));
        vm.stopPrank();
    }

    function test_SetVaultRevertsOnZeroAddress() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidVault.selector);
        estate.setVault(address(0));
    }

    function test_SetVaultRevertsOnEOA() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidVault.selector);
        estate.setVault(stranger);
    }

    function test_MarkDistributedRevertsWhenNotVault() public {
        EstateVault vault = new EstateVault(address(estate));
        vm.prank(ownerAddr);
        estate.setVault(address(vault));

        vm.prank(stranger);
        vm.expectRevert(NotVault.selector);
        estate.markDistributed();
    }

    function test_MarkDistributedSucceedsFromVault() public {
        EstateVault vault = new EstateVault(address(estate));
        vm.prank(ownerAddr);
        estate.setVault(address(vault));

        vm.prank(address(vault));
        estate.markDistributed();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Distributed));
    }
}

contract EstateInfoViewTest is EstateTestBase {
    function test_GetEstateInfoReflectsCurrentState() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);

        Estate.EstateInfo memory info = estate.getEstateInfo();

        assertEq(uint8(info.state), uint8(Estate.EstateState.Active));
        assertEq(info.lastCheckIn, block.timestamp);
        assertEq(info.heartbeatEnds, estate.heartbeatExpiresAt());
        assertEq(info.graceEnds, estate.graceEndsAt());
        assertEq(info.beneficiaryCount, 1);
        assertEq(info.approvalCount, 0);
    }

    function test_GetEstateInfoBeneficiaryCountExcludesRemoved() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.addBeneficiary(ben2, 5000);
        estate.removeBeneficiary(1);
        vm.stopPrank();

        assertEq(estate.getEstateInfo().beneficiaryCount, 1);
    }
}
