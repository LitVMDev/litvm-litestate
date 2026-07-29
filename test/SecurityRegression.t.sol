// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Regression suite for the findings raised in the security review. Each test
// pins a fix in place, or documents a residual risk that was accepted as a
// deliberate design decision.

import "./helpers/EstateTestBase.sol";
import "../src/EstateFactory.sol";

// ------------------------------------------------------------
// Fixed
// ------------------------------------------------------------

contract Regression_FundsCannotStrand is EstateTestBase {
    // F1: an under-allocated estate used to be permanently undistributable.
    function test_UnderAllocatedEstateStillDistributes() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 9000); // deliberately short of 100%

        vm.deal(address(vault), 100 ether);
        warpPastGrace();

        vault.distribute();

        assertEq(vault.claimable(ben1), 90 ether + 10 ether); // share + residue
        assertEq(vault.totalClaimable(), 100 ether);
    }

    // F1: with a residuary nominated, the unallocated portion goes to them.
    function test_ResiduaryBeneficiaryReceivesUnallocatedPortion() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 2500);
        estate.addBeneficiary(ben2, 2500);
        estate.setResiduaryBeneficiary(residuary);
        vm.stopPrank();

        vm.deal(address(vault), 100 ether);
        warpPastGrace();

        vault.distribute();

        assertEq(vault.claimable(ben1), 25 ether);
        assertEq(vault.claimable(ben2), 25 ether);
        assertEq(vault.claimable(residuary), 50 ether);

        // The full balance is always accounted for.
        assertEq(vault.claimable(ben1) + vault.claimable(ben2) + vault.claimable(residuary), 100 ether);
    }

    // F5: an empty vault can no longer be used to burn the one-shot distribution.
    function test_EmptyVaultCannotBeDistributed() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        warpPastGrace();

        vm.prank(stranger);
        vm.expectRevert(NothingToDistribute.selector);
        vault.distribute();

        // The estate survives the griefing attempt and still works once funded.
        vm.deal(stranger, 100 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 100 ether}("");
        assertTrue(ok);

        vault.distribute();
        assertEq(vault.claimable(ben1), 100 ether);
    }
}

contract Regression_ConfigValidation is EstateTestBase {
    // F10/F13: an incoherent approval policy is rejected at construction.
    function test_ZeroThresholdRejected() public {
        vm.expectRevert(InvalidApprovalPolicy.selector);
        new Estate(ownerAddr, defaultSettings(DistributionMode.ApprovalRequired), defaultPolicy(0), testLimits());
    }

    function test_ThresholdAboveMaxApproversRejected() public {
        vm.expectRevert(InvalidApprovalPolicy.selector);
        new Estate(
            ownerAddr,
            defaultSettings(DistributionMode.ApprovalRequired),
            defaultPolicy(PLATFORM_MAX_APPROVERS + 1),
            testLimits()
        );
    }

    function test_ZeroApprovalWindowRejected() public {
        ApprovalPolicy memory policy = policyOf(ApprovalRule.AnyOne);
        policy.approvalWindow = 0;

        vm.expectRevert(InvalidApprovalWindow.selector);
        new Estate(ownerAddr, defaultSettings(DistributionMode.ApprovalRequired), policy, testLimits());
    }

    // F2: approvers can no longer be removed down to an unreachable quorum.
    function test_CannotRemoveLastApprover() public {
        Estate estate = deployEstate(DistributionMode.ApprovalRequired, 1);

        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);

        vm.expectRevert(InvalidApprovalPolicy.selector);
        estate.removeApprover(1);
        vm.stopPrank();
    }

    function test_ApproverCountIsCapped() public {
        Estate estate = deployEstate(DistributionMode.ApprovalRequired, 1);

        vm.startPrank(ownerAddr);
        for (uint256 i = 0; i < PLATFORM_MAX_APPROVERS; i++) {
            estate.addApprover(address(uint160(0xA11CE000 + i)));
        }

        vm.expectRevert(TooManyApprovers.selector);
        estate.addApprover(approver1);
        vm.stopPrank();
    }

    // F7: oversized shares report the intended error, not an arithmetic panic.
    function test_OversizedShareRevertsCleanly() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);

        vm.expectRevert(AllocationExceeds100Percent.selector);
        estate.addBeneficiary(ben2, 65_535);
        vm.stopPrank();
    }

    // F12: an unlinked vault is reported as not-ready instead of failing late.
    function test_UnlinkedVaultReportsNotReady() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);
        EstateVault vault = new EstateVault(address(estate));
        // setVault deliberately not called.

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        vm.deal(address(vault), 100 ether);
        warpPastGrace();

        assertFalse(estate.canDistribute());

        vm.expectRevert(DistributionNotReady.selector);
        vault.distribute();
    }
}

contract Regression_ConfigurationGate is EstateTestBase {
    // F14: a Threshold higher than the number of approvers ever added used to
    // lock the vault permanently - even with every approver willing to sign.
    // Funding such an estate is now impossible in the first place.
    function test_CannotFundEstateWhoseThresholdExceedsApprovers() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.ApprovalRequired, 3);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        estate.addApprover(approver1);
        estate.addApprover(approver2); // one short of the threshold
        vm.stopPrank();

        assertFalse(estate.isFullyConfigured());

        vm.deal(stranger, 100 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 100 ether}("");
        assertFalse(ok);

        // Adding the missing approver unblocks funding.
        vm.prank(ownerAddr);
        estate.addApprover(approver3);

        assertTrue(estate.isFullyConfigured());

        vm.prank(stranger);
        (bool ok2,) = address(vault).call{value: 100 ether}("");
        assertTrue(ok2);
        assertEq(vault.balance(), 100 ether);
    }

    function test_CannotFundEstateWithNoRecipients() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        assertFalse(estate.isFullyConfigured());

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);

        // A residuary beneficiary alone is enough to make it fundable.
        vm.prank(ownerAddr);
        estate.setResiduaryBeneficiary(residuary);

        assertTrue(estate.isFullyConfigured());

        vm.prank(stranger);
        (bool ok2,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok2);
    }

    function test_CannotFundApprovalEstateWithNoApprovers() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.ApprovalRequired, 1);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        assertFalse(estate.isFullyConfigured());

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // All/AnyOne size themselves to the live approver count, so they are
    // satisfiable as soon as a single approver exists.
    function test_AllRuleIsConfiguredWithAnyNonZeroApproverCount() public {
        Estate estate = new Estate(
            ownerAddr, defaultSettings(DistributionMode.ApprovalRequired), policyOf(ApprovalRule.All), testLimits()
        );

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        assertFalse(estate.isFullyConfigured()); // no approvers yet

        estate.addApprover(approver1);
        assertTrue(estate.isFullyConfigured());
        vm.stopPrank();
    }

    // Configuration cannot silently degrade after funding.
    function test_CannotRemoveLastRecipientOnceFunded() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        vm.prank(ownerAddr);
        vm.expectRevert(NoRecipients.selector);
        estate.removeBeneficiary(1);

        // Still fine while the estate holds nothing.
        (Estate empty,) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.startPrank(ownerAddr);
        empty.addBeneficiary(ben1, 10_000);
        empty.removeBeneficiary(1); // no funds at risk
        vm.stopPrank();
    }

    function test_CannotClearResiduaryAsLastRecipientOnceFunded() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.setResiduaryBeneficiary(residuary);

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        vm.prank(ownerAddr);
        vm.expectRevert(NoRecipients.selector);
        estate.setResiduaryBeneficiary(address(0));
    }
}

contract Regression_OwnerCannotApprove is EstateTestBase {
    // F15: the owner could name themselves an approver, producing an estate
    // whose quorum only a dead person could ever satisfy.
    function test_OwnerCannotBeAddedAsApprover() public {
        Estate estate = deployEstate(DistributionMode.ApprovalRequired, 1);

        vm.prank(ownerAddr);
        vm.expectRevert(OwnerCannotApprove.selector);
        estate.addApprover(ownerAddr);
    }

    function test_OwnerStillCannotApproveViaAnotherRoute() public {
        (Estate estate,) = deployEstateWithVault(DistributionMode.ApprovalRequired, 1);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        estate.addApprover(approver1);
        vm.stopPrank();

        warpPastGrace();

        vm.prank(ownerAddr);
        vm.expectRevert(NotApprover.selector);
        estate.approveDistribution();
    }
}

contract Regression_ResiduaryRequired is EstateTestBase {
    // F16: unallocated funds used to fall to whichever beneficiary happened to
    // be stored last, so identical shares paid out differently depending on
    // insertion order and removal history.
    function test_UnderAllocatedIsNotFullyConfiguredWithoutResiduary() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        assertFalse(estate.isFullyConfigured());

        estate.setResiduaryBeneficiary(residuary);
        assertTrue(estate.isFullyConfigured());
        vm.stopPrank();
    }

    function test_FullyAllocatedNeedsNoResiduary() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        assertTrue(estate.isFullyConfigured());
    }

    // Configuration cannot silently degrade below "distributable" once funded.
    function test_CannotDropBelowFullAllocationOnceFundedWithoutResiduary() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 6000);
        estate.addBeneficiary(ben2, 4000);
        vm.stopPrank();

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        // Removing one would leave 60% allocated and no residuary.
        vm.prank(ownerAddr);
        vm.expectRevert(ResiduaryBeneficiaryRequired.selector);
        estate.removeBeneficiary(2);

        // Lowering a share has the same effect.
        vm.prank(ownerAddr);
        vm.expectRevert(ResiduaryBeneficiaryRequired.selector);
        estate.updateBeneficiary(2, 1000);

        // With a residuary named, both become allowed.
        vm.startPrank(ownerAddr);
        estate.setResiduaryBeneficiary(residuary);
        estate.updateBeneficiary(2, 1000);
        vm.stopPrank();

        assertEq(estate.totalAllocatedBps(), 7000);
    }

    // Reported route into a funded estate that could no longer take deposits:
    // fully allocated, funded, drop the residuary, then drop a beneficiary.
    // Clearing the residuary is legitimate at 100% - nothing is unallocated -
    // so the guard has to hold on the *second* step, which is the one that
    // creates the gap. Left open, this would leave a funded estate refusing
    // deposits it should still accept.
    function test_ClearingResiduaryAtFullAllocationStillBlocksTheNextRemoval() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 6000);
        estate.addBeneficiary(ben2, 4000);
        estate.setResiduaryBeneficiary(residuary);
        vm.stopPrank();

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        // Allowed: shares already total 100%, so nothing loses its destination.
        vm.prank(ownerAddr);
        estate.setResiduaryBeneficiary(address(0));

        vm.prank(ownerAddr);
        vm.expectRevert(ResiduaryBeneficiaryRequired.selector);
        estate.removeBeneficiary(2);

        // The estate is untouched by the refused edit and still fundable.
        assertEq(estate.totalAllocatedBps(), 10_000);
        assertTrue(estate.isFullyConfigured());

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool stillOk,) = address(vault).call{value: 1 ether}("");
        assertTrue(stillOk);
    }

    // The mirror image: withdrawal is never gated on configuration, so even an
    // estate that has fallen out of a fundable shape cannot trap the balance.
    // The only way in is a forced send (selfdestruct/coinbase), which bypasses
    // the vault's receive() - vm.deal stands in for that here.
    function test_OwnerCanWithdrawWhileEstateIsNotFullyConfigured() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);

        assertFalse(estate.isFullyConfigured()); // 50% allocated, no residuary

        vm.deal(address(vault), 5 ether);

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool depositOk,) = address(vault).call{value: 1 ether}("");
        assertFalse(depositOk); // deposits refused...

        uint256 before = ownerAddr.balance;
        vm.prank(ownerAddr);
        vault.withdraw(5 ether); // ...withdrawal is not

        assertEq(ownerAddr.balance - before, 5 ether);
        assertEq(vault.balance(), 0);

        // And the owner can always repair it back into a fundable shape.
        vm.prank(ownerAddr);
        estate.setResiduaryBeneficiary(residuary);
        assertTrue(estate.isFullyConfigured());
    }

    function test_CannotClearResiduaryWhileUnderAllocatedAndFunded() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.setResiduaryBeneficiary(residuary);
        vm.stopPrank();

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        vm.prank(ownerAddr);
        vm.expectRevert(ResiduaryBeneficiaryRequired.selector);
        estate.setResiduaryBeneficiary(address(0));
    }
}

contract Regression_MisdirectedFunds is EstateTestBase {
    // Only the vault holds funds. Estate and EstateFactory deliberately have no
    // receive() or fallback(), so a transfer to the wrong address reverts and
    // the sender keeps their money rather than losing it to a contract that
    // cannot pay it back out.
    //
    // If anyone ever adds a receive() to Estate, this test should fail loudly.
    function test_PlainTransferToEstateReverts() public {
        (Estate estate,) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(estate).call{value: 1 ether}("");

        assertFalse(ok, "Estate must not accept plain transfers");
        assertEq(address(estate).balance, 0);
        assertEq(stranger.balance, 10 ether, "sender keeps their funds");
    }

    function test_PlainTransferToFactoryReverts() public {
        EstateFactory f = new EstateFactory(testLimits());

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(f).call{value: 1 ether}("");

        assertFalse(ok, "Factory must not accept plain transfers");
        assertEq(address(f).balance, 0);
    }

    function test_VaultIsTheOnlyFundingPath() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 5 ether}("");

        assertTrue(ok);
        assertEq(address(vault).balance, 5 ether);
    }
}

contract Regression_TimingEdits is EstateTestBase {
    // F17: heartbeatExpiresAt() is lastCheckIn + interval, so leaving
    // lastCheckIn alone while shortening the interval moved the deadline
    // backwards. Shortened past the elapsed time it landed in the past, taking
    // a healthy estate straight through GracePeriod into ReadyForDistribution
    // — and checkIn() is barred once grace has expired, so the owner could not
    // undo it. One parameter could release an entire estate irreversibly.
    //
    // updateHeartbeat now restarts the clock, so the deadline is always
    // now + interval and can never land in the past.
    function test_ShorteningHeartbeatRestartsTheClockInsteadOfExpiring() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.updateHeartbeat(365 days);

        vm.warp(block.timestamp + 300 days);
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));

        // 60 days is far less than the 300 already elapsed.
        vm.prank(ownerAddr);
        estate.updateHeartbeat(60 days);

        // Still healthy, and the deadline is a full 60 days from now.
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
        assertFalse(estate.heartbeatExpired());
        assertEq(estate.lastCheckIn(), block.timestamp);
        assertEq(estate.heartbeatExpiresAt(), block.timestamp + 60 days);
    }

    // The reset is a real check-in, so it emits CheckedIn for indexers and the
    // UI countdown.
    function test_UpdateHeartbeatEmitsCheckedIn() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.warp(block.timestamp + 5 days);

        vm.expectEmit(true, false, false, true, address(estate));
        emit Estate.CheckedIn(ownerAddr, block.timestamp);

        vm.prank(ownerAddr);
        estate.updateHeartbeat(60 days);
    }

    // Extending works the same way: the full new period, counted from now.
    function test_ExtendingHeartbeatAlsoCountsFromNow() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.warp(block.timestamp + 20 days);

        vm.prank(ownerAddr);
        estate.updateHeartbeat(200 days);

        assertEq(estate.heartbeatExpiresAt(), block.timestamp + 200 days);
    }

    // Shortening is fine as long as the deadline stays in the future.
    function test_ShorteningHeartbeatIsAllowedWhenDeadlineStaysFuture() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.updateHeartbeat(365 days);

        vm.warp(block.timestamp + 10 days);

        vm.prank(ownerAddr);
        estate.updateHeartbeat(60 days);

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
        assertEq(estate.heartbeatExpiresAt(), estate.lastCheckIn() + 60 days);
        assertEq(estate.lastCheckIn(), block.timestamp); // clock restarted
    }

    // Checking in first resets the clock, making any valid interval safe.
    function test_CheckInFirstThenShortenWorks() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.updateHeartbeat(365 days);
        vm.warp(block.timestamp + 300 days);

        estate.checkIn(); // resets lastCheckIn to now
        estate.updateHeartbeat(PLATFORM_MIN_HEARTBEAT);
        vm.stopPrank();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
    }

    // Grace has no equivalent hazard: graceEndsAt is heartbeatExpiresAt +
    // period, and onlyWhileActive guarantees heartbeatExpiresAt is in the
    // future, so shortening grace can never land in the past.
    function test_ShorteningGraceIsAlwaysSafe() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        estate.updateGracePeriod(PLATFORM_MAX_GRACE);
        estate.updateGracePeriod(PLATFORM_MIN_GRACE);
        vm.stopPrank();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Active));
        assertFalse(estate.graceExpired());
    }

    function test_TimingCannotBeEditedOnceHeartbeatLapsed() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);
        warpPastHeartbeat();

        vm.startPrank(ownerAddr);
        vm.expectRevert(HeartbeatExpired.selector);
        estate.updateHeartbeat(60 days);

        vm.expectRevert(HeartbeatExpired.selector);
        estate.updateGracePeriod(30 days);
        vm.stopPrank();
    }
}

contract Regression_ApprovalRules is EstateTestBase {
    function _estateWithRule(ApprovalRule rule) internal returns (Estate estate) {
        estate = new Estate(ownerAddr, defaultSettings(DistributionMode.ApprovalRequired), policyOf(rule), testLimits());
    }

    function test_AnyOneNeedsASingleApproval() public {
        Estate estate = _estateWithRule(ApprovalRule.AnyOne);

        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        estate.addApprover(approver3);
        vm.stopPrank();

        assertEq(estate.requiredApprovals(), 1);

        warpPastGrace();

        vm.prank(approver2);
        estate.approveDistribution();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.ReadyForDistribution));
    }

    function test_AllTracksLiveApproverCount() public {
        Estate estate = _estateWithRule(ApprovalRule.All);

        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        estate.addApprover(approver3);
        vm.stopPrank();

        assertEq(estate.requiredApprovals(), 3);

        // Removing one lowers the requirement rather than stranding the estate.
        vm.prank(ownerAddr);
        estate.removeApprover(3);
        assertEq(estate.requiredApprovals(), 2);

        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));

        vm.prank(approver2);
        estate.approveDistribution();
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.ReadyForDistribution));
    }

    function test_ThresholdRequiresExactCount() public {
        Estate estate = deployEstate(DistributionMode.ApprovalRequired, 2);

        vm.startPrank(ownerAddr);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        estate.addApprover(approver3);
        vm.stopPrank();

        assertEq(estate.requiredApprovals(), 2);

        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));

        vm.prank(approver3);
        estate.approveDistribution();
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.ReadyForDistribution));
    }

    // An approval rule must never pass by default just because nobody can vote.
    function test_ZeroApproversNeverAutoApproves() public {
        Estate estate = _estateWithRule(ApprovalRule.All);

        assertEq(estate.activeApproverCount(), 0);

        warpPastGrace();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));
        assertFalse(estate.canDistribute());
    }
}

contract Regression_Gas is EstateTestBase {
    // F11: removed beneficiaries are swap-popped, so distribution cost tracks
    // the number of live beneficiaries rather than lifetime churn.
    function test_ChurnDoesNotInflateDistributionGas() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.startPrank(ownerAddr);
        for (uint256 i = 0; i < 200; i++) {
            address churn = address(uint160(0xC0FFEE0000 + i));
            estate.addBeneficiary(churn, 1);
            estate.removeBeneficiary(i + 1);
        }
        estate.addBeneficiary(ben1, 10_000);
        vm.stopPrank();

        assertEq(estate.beneficiaryCount(), 1);
        assertEq(estate.getBeneficiaryIds().length, 1); // no dead weight retained

        vm.deal(address(vault), 100 ether);
        warpPastGrace();

        uint256 gasBefore = gasleft();
        vault.distribute();
        uint256 used = gasBefore - gasleft();

        emit log_named_uint("distribute() gas after 200 add/remove cycles", used);

        assertEq(vault.claimable(ben1), 100 ether);
        assertLt(used, 200_000);
    }
}

// ------------------------------------------------------------
// Accepted residual risks - documented, deliberately not "fixed"
// ------------------------------------------------------------

contract Accepted_KnownRisks is EstateTestBase {
    // F3 (accepted): approvers hold a genuine veto. If quorum is never reached
    // before the approval window closes, the estate stays locked. This is the
    // chosen trade-off: approvers are a real gate, not merely an accelerator.
    function test_Accepted_ApprovalWindowExpiryLocksEstate() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.ApprovalRequired, 2);

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        vm.stopPrank();

        vm.deal(address(vault), 100 ether);
        warpPastApprovalWindow();

        vm.prank(approver1);
        vm.expectRevert(ApprovalWindowExpired.selector);
        estate.approveDistribution();

        vm.expectRevert(DistributionNotReady.selector);
        vault.distribute();
    }

    // F2 (accepted, largely neutralised): an ApprovalRequired estate with no
    // approvers cannot distribute. The deposit gate now makes this state
    // unfundable through normal transfers, so it is only reachable by a forced
    // balance change - selfdestruct, a block reward, or vm.deal as used here.
    function test_Accepted_ApprovalEstateWithNoApproversCannotDistribute() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.ApprovalRequired, 1);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        vm.deal(address(vault), 100 ether);
        warpPastGrace();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.AwaitingApproval));

        vm.expectRevert(DistributionNotReady.selector);
        vault.distribute();
    }

    // F6 (accepted): the owner keeps full control of their funds until the
    // estate is actually distributed. No contract can distinguish a living
    // owner from a stolen key, so key custody remains the security boundary.
    function test_Accepted_OwnerCanWithdrawUntilDistribution() public {
        (Estate estate, EstateVault vault) = deployEstateWithVault(DistributionMode.Automatic, 0);

        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        vm.deal(address(vault), 100 ether);
        warpPastGrace();

        assertTrue(estate.canDistribute());

        vm.prank(ownerAddr);
        vault.withdraw(100 ether);

        assertEq(ownerAddr.balance, 100 ether);

        // ...but an emptied vault can no longer be "distributed" into a brick.
        vm.expectRevert(NothingToDistribute.selector);
        vault.distribute();
    }
}
