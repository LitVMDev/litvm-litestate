// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./helpers/EstateTestBase.sol";

contract EstateVaultConstructorTest is EstateTestBase {
    function test_ConstructorSetsEstate() public {
        Estate estate = deployEstate(DistributionMode.Automatic, 0);
        EstateVault vault = new EstateVault(address(estate));

        assertEq(address(vault.estate()), address(estate));
    }
}

contract EstateVaultDepositTest is EstateTestBase {
    Estate internal estate;
    EstateVault internal vault;

    function setUp() public {
        (estate, vault) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
    }

    function test_DepositIncreasesBalance() public {
        vm.deal(stranger, 5 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 5 ether}("");

        assertTrue(ok);
        assertEq(vault.balance(), 5 ether);
    }

    function test_DepositEmitsDeposited() public {
        vm.deal(stranger, 1 ether);

        vm.expectEmit(true, false, false, true, address(vault));
        emit EstateVault.Deposited(stranger, 1 ether);

        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertTrue(ok);
    }

    function test_DepositRevertsAfterDistributed() public {
        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        warpPastGrace();
        vault.distribute();

        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok2,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok2);
    }
}

contract EstateVaultWithdrawTest is EstateTestBase {
    Estate internal estate;
    EstateVault internal vault;

    function setUp() public {
        (estate, vault) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.deal(address(vault), 10 ether);
    }

    function test_OwnerCanWithdraw() public {
        uint256 before = ownerAddr.balance;

        vm.prank(ownerAddr);
        vault.withdraw(4 ether);

        assertEq(ownerAddr.balance, before + 4 ether);
        assertEq(vault.balance(), 6 ether);
    }

    function test_WithdrawEmitsWithdrawn() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit EstateVault.Withdrawn(ownerAddr, 2 ether);

        vm.prank(ownerAddr);
        vault.withdraw(2 ether);
    }

    function test_NonOwnerCannotWithdraw() public {
        vm.prank(stranger);
        vm.expectRevert(NotOwner.selector);
        vault.withdraw(1 ether);
    }

    function test_WithdrawRevertsWhenAmountExceedsBalance() public {
        vm.prank(ownerAddr);
        vm.expectRevert(WithdrawalFailed.selector);
        vault.withdraw(11 ether);
    }

    function test_WithdrawRevertsWhenTransferFails() public {
        RevertingReceiver rejecting = new RevertingReceiver();
        Estate rejectingEstate = deployEstate(address(rejecting), DistributionMode.Automatic, 0);
        EstateVault rejectingVault = new EstateVault(address(rejectingEstate));
        vm.deal(address(rejectingVault), 5 ether);

        vm.prank(address(rejecting));
        vm.expectRevert(WithdrawalFailed.selector);
        rejectingVault.withdraw(1 ether);
    }

    function test_WithdrawRevertsAfterDistributed() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        warpPastGrace();
        vault.distribute();

        vm.prank(ownerAddr);
        vm.expectRevert(DistributionAlreadyCompleted.selector);
        vault.withdraw(1 ether);
    }
}

contract EstateVaultAutomaticDistributionTest is EstateTestBase {
    Estate internal estate;
    EstateVault internal vault;

    function setUp() public {
        (estate, vault) = deployEstateWithVault(DistributionMode.Automatic, 0);
    }

    function test_DistributeUnderAllocatedSendsRemainderToResiduary() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000); // literal 50%
        estate.setResiduaryBeneficiary(residuary);
        vm.stopPrank();

        vm.deal(address(vault), 10 ether);
        warpPastGrace();
        vault.distribute();

        assertEq(vault.claimable(ben1), 5 ether);
        assertEq(vault.claimable(residuary), 5 ether);
        assertEq(vault.totalClaimable(), 10 ether);
    }

    function test_UnderAllocatedEstateCannotBeFundedWithoutResiduary() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3000);
        estate.addBeneficiary(ben2, 2000); // 50% total, no residuary
        vm.stopPrank();

        // Payouts must never depend on which beneficiary happens to be stored
        // last, so an under-allocated estate is simply not fundable.
        assertFalse(estate.isFullyConfigured());

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertFalse(ok);
    }

    function test_PayoutIsIndependentOfBeneficiaryOrder() public {
        // Same shares, opposite insertion order, same residuary -> identical
        // payouts. This used to differ wildly.
        (Estate a, EstateVault av) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.startPrank(ownerAddr);
        a.addBeneficiary(ben1, 5000);
        a.addBeneficiary(ben2, 1000);
        a.setResiduaryBeneficiary(residuary);
        vm.stopPrank();

        (Estate b, EstateVault bv) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.startPrank(ownerAddr);
        b.addBeneficiary(ben2, 1000);
        b.addBeneficiary(ben1, 5000);
        b.setResiduaryBeneficiary(residuary);
        vm.stopPrank();

        vm.deal(address(av), 100 ether);
        vm.deal(address(bv), 100 ether);
        warpPastGrace();
        av.distribute();
        bv.distribute();

        assertEq(av.claimable(ben1), 50 ether);
        assertEq(av.claimable(ben2), 10 ether);
        assertEq(av.claimable(residuary), 40 ether);

        assertEq(bv.claimable(ben1), av.claimable(ben1));
        assertEq(bv.claimable(ben2), av.claimable(ben2));
        assertEq(bv.claimable(residuary), av.claimable(residuary));
    }

    function test_DistributeToResiduaryOnlyEstate() public {
        vm.prank(ownerAddr);
        estate.setResiduaryBeneficiary(residuary);

        vm.deal(address(vault), 10 ether);
        warpPastGrace();
        vault.distribute();

        assertEq(vault.claimable(residuary), 10 ether);
    }

    function test_DistributeRevertsWhenNoRecipients() public {
        vm.deal(address(vault), 10 ether);
        warpPastGrace();

        vm.expectRevert(NoRecipients.selector);
        vault.distribute();
    }

    function test_DistributeRevertsWhenVaultEmpty() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);

        warpPastGrace();

        vm.expectRevert(NothingToDistribute.selector);
        vault.distribute();
    }

    function test_DistributeRevertsWhenGraceNotYetExpired() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        vm.deal(address(vault), 10 ether);

        vm.expectRevert(DistributionNotReady.selector);
        vault.distribute();
    }

    function test_DistributeSplitsProportionally() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000); // 50%
        estate.addBeneficiary(ben2, 3000); // 30%
        estate.addBeneficiary(ben3, 2000); // 20%
        vm.stopPrank();

        vm.deal(address(vault), 10 ether);

        warpPastGrace();
        vault.distribute();

        assertEq(vault.claimable(ben1), 5 ether);
        assertEq(vault.claimable(ben2), 3 ether);
        assertEq(vault.claimable(ben3), 2 ether);
        assertEq(vault.totalClaimable(), 10 ether);
        assertTrue(vault.distributed());
    }

    function test_DistributeAssignsRoundingRemainderToLastActiveBeneficiary() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 3334);
        estate.addBeneficiary(ben2, 3333);
        estate.addBeneficiary(ben3, 3333);
        vm.stopPrank();

        vm.deal(address(vault), 10 ether); // not evenly divisible by 3

        warpPastGrace();
        vault.distribute();

        uint256 total = vault.claimable(ben1) + vault.claimable(ben2) + vault.claimable(ben3);
        assertEq(total, 10 ether);
        // last active beneficiary (ben3) absorbs the rounding dust
        assertEq(vault.claimable(ben3), 10 ether - (10 ether * 3334 / 10_000) - (10 ether * 3333 / 10_000));
    }

    function test_DistributeSkipsRemovedBeneficiaries() public {
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 5000);
        estate.addBeneficiary(ben2, 5000);
        estate.removeBeneficiary(1);
        estate.addBeneficiary(ben3, 5000);
        vm.stopPrank();

        vm.deal(address(vault), 10 ether);

        warpPastGrace();
        vault.distribute();

        assertEq(vault.claimable(ben1), 0);
        assertEq(vault.claimable(ben2), 5 ether);
        assertEq(vault.claimable(ben3), 5 ether);
    }

    function test_DistributeMarksEstateDistributed() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        vm.deal(address(vault), 10 ether);

        warpPastGrace();
        vault.distribute();

        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Distributed));
        assertFalse(estate.canDistribute());
    }

    function test_DistributeRevertsOnSecondCall() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        vm.deal(address(vault), 10 ether);

        warpPastGrace();
        vault.distribute();

        vm.expectRevert(DistributionAlreadyCompleted.selector);
        vault.distribute();
    }

    function test_DistributeCallableByAnyone() public {
        vm.prank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        vm.deal(address(vault), 10 ether);

        warpPastGrace();

        vm.prank(stranger);
        vault.distribute();

        assertTrue(vault.distributed());
    }
}

contract EstateVaultApprovalRequiredDistributionTest is EstateTestBase {
    Estate internal estate;
    EstateVault internal vault;

    function setUp() public {
        (estate, vault) = deployEstateWithVault(DistributionMode.ApprovalRequired, 2);
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 10_000);
        estate.addApprover(approver1);
        estate.addApprover(approver2);
        vm.stopPrank();
        vm.deal(address(vault), 10 ether);
    }

    function test_DistributeRevertsWhileAwaitingApproval() public {
        warpPastGrace();

        vm.expectRevert(DistributionNotReady.selector);
        vault.distribute();
    }

    function test_DistributeRevertsWithPartialApprovals() public {
        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();

        vm.expectRevert(DistributionNotReady.selector);
        vault.distribute();
    }

    function test_DistributeSucceedsOnceQuorumReached() public {
        warpPastGrace();

        vm.prank(approver1);
        estate.approveDistribution();
        vm.prank(approver2);
        estate.approveDistribution();

        vault.distribute();

        assertEq(vault.claimable(ben1), 10 ether);
        assertTrue(vault.distributed());
    }
}

contract EstateVaultClaimTest is EstateTestBase {
    Estate internal estate;
    EstateVault internal vault;

    function setUp() public {
        (estate, vault) = deployEstateWithVault(DistributionMode.Automatic, 0);
        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 6000);
        estate.addBeneficiary(ben2, 4000);
        vm.stopPrank();

        vm.deal(address(vault), 10 ether);
        warpPastGrace();
        vault.distribute();
    }

    function test_ClaimTransfersFunds() public {
        uint256 before = ben1.balance;

        vm.prank(ben1);
        vault.claim();

        assertEq(ben1.balance, before + 6 ether);
        assertEq(vault.claimable(ben1), 0);
    }

    function test_ClaimEmitsClaimed() public {
        vm.expectEmit(true, false, false, true, address(vault));
        emit EstateVault.Claimed(ben1, 6 ether);

        vm.prank(ben1);
        vault.claim();
    }

    function test_ClaimUpdatesTotalClaimable() public {
        vm.prank(ben1);
        vault.claim();

        assertEq(vault.totalClaimable(), 4 ether);
    }

    function test_ClaimRevertsWhenNothingToClaim() public {
        vm.prank(stranger);
        vm.expectRevert(NothingToClaim.selector);
        vault.claim();
    }

    function test_ClaimRevertsOnDoubleClaim() public {
        vm.startPrank(ben1);
        vault.claim();

        vm.expectRevert(NothingToClaim.selector);
        vault.claim();
        vm.stopPrank();
    }

    function test_ClaimRevertsWhenTransferFails() public {
        RevertingReceiver rejecting = new RevertingReceiver();

        Estate rejectingEstate = deployEstate(DistributionMode.Automatic, 0);
        EstateVault rejectingVault = new EstateVault(address(rejectingEstate));
        vm.prank(ownerAddr);
        rejectingEstate.setVault(address(rejectingVault));

        vm.prank(ownerAddr);
        rejectingEstate.addBeneficiary(address(rejecting), 10_000);

        vm.deal(address(rejectingVault), 5 ether);
        vm.warp(block.timestamp + HEARTBEAT + GRACE + 1);
        rejectingVault.distribute();

        vm.prank(address(rejecting));
        vm.expectRevert(DistributionFailed.selector);
        rejectingVault.claim();
    }
}
