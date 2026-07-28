// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./helpers/EstateTestBase.sol";
import "../src/EstateFactory.sol";

contract EstateFactoryTest is EstateTestBase {
    EstateFactory internal factory;

    function setUp() public {
        factory = new EstateFactory(testLimits());
    }

    function _create(address asOwner) internal returns (Estate estate, EstateVault vault) {
        vm.prank(asOwner);
        (address e, address v) =
            factory.createEstate(defaultSettings(DistributionMode.ApprovalRequired), policyOf(ApprovalRule.AnyOne));

        return (Estate(e), EstateVault(payable(v)));
    }

    function test_CallerBecomesOwnerNotTheFactory() public {
        (Estate estate,) = _create(ownerAddr);

        assertEq(estate.owner(), ownerAddr);
        assertTrue(estate.owner() != address(factory));
    }

    // The whole point of the factory: estate and vault can never be left
    // unwired, so the "forgot setVault()" hazard cannot occur.
    function test_EstateAndVaultAreWiredAtomically() public {
        (Estate estate, EstateVault vault) = _create(ownerAddr);

        assertEq(estate.vault(), address(vault));
        assertEq(address(vault.estate()), address(estate));
    }

    function test_VaultCannotBeReassignedAfterCreation() public {
        (Estate estate,) = _create(ownerAddr);

        EstateVault rogue = new EstateVault(address(estate));

        vm.prank(ownerAddr);
        vm.expectRevert(VaultAlreadySet.selector);
        estate.setVault(address(rogue));
    }

    function test_FactoryCannotReassignVaultEither() public {
        (Estate estate,) = _create(ownerAddr);

        EstateVault rogue = new EstateVault(address(estate));

        vm.prank(address(factory));
        vm.expectRevert(VaultAlreadySet.selector);
        estate.setVault(address(rogue));
    }

    function test_RegistryTracksEstatesPerOwner() public {
        (Estate first,) = _create(ownerAddr);
        (Estate second,) = _create(ownerAddr);
        (Estate other,) = _create(stranger);

        address[] memory mine = factory.estatesOf(ownerAddr);
        assertEq(mine.length, 2);
        assertEq(mine[0], address(first));
        assertEq(mine[1], address(second));

        assertEq(factory.estateCountOf(ownerAddr), 2);
        assertEq(factory.estateCountOf(stranger), 1);
        assertEq(factory.estatesOf(stranger)[0], address(other));

        assertEq(factory.totalEstates(), 3);
        assertEq(factory.allEstates().length, 3);
    }

    function test_RegistryEmptyForUnknownOwner() public view {
        assertEq(factory.estatesOf(stranger).length, 0);
        assertEq(factory.estateCountOf(stranger), 0);
    }

    function test_EmitsEstateCreated() public {
        vm.recordLogs();

        vm.prank(ownerAddr);
        (address estate, address vault) =
            factory.createEstate(defaultSettings(DistributionMode.Automatic), policyOf(ApprovalRule.AnyOne));

        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 sig = keccak256("EstateCreated(address,address,address)");
        bool found;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(factory) && logs[i].topics[0] == sig) {
                assertEq(address(uint160(uint256(logs[i].topics[1]))), ownerAddr);
                assertEq(address(uint160(uint256(logs[i].topics[2]))), estate);
                assertEq(address(uint160(uint256(logs[i].topics[3]))), vault);
                found = true;
            }
        }

        assertTrue(found, "EstateCreated not emitted");
    }

    // Each user's settings are their own - the factory imposes nothing beyond
    // Estate's platform constants.
    function test_EachEstateKeepsItsOwnSettings() public {
        EstateSettings memory slow =
            EstateSettings({heartbeatInterval: 365 days, gracePeriod: 90 days, mode: DistributionMode.Automatic});

        EstateSettings memory fast = defaultSettings(DistributionMode.ApprovalRequired);

        vm.prank(ownerAddr);
        (address slowEstate,) = factory.createEstate(slow, policyOf(ApprovalRule.AnyOne));

        vm.prank(stranger);
        (address fastEstate,) = factory.createEstate(fast, policyOf(ApprovalRule.All));

        assertEq(Estate(slowEstate).heartbeatExpiresAt(), block.timestamp + 365 days);
        assertEq(Estate(fastEstate).heartbeatExpiresAt(), block.timestamp + HEARTBEAT);
        assertEq(uint8(Estate(fastEstate).requiredApprovals()), 0); // no approvers yet
    }

    // Platform limits still bind: the factory is not an escape hatch.
    function test_FactoryStillEnforcesPlatformLimits() public {
        EstateSettings memory tooShort = defaultSettings(DistributionMode.Automatic);
        tooShort.heartbeatInterval = PLATFORM_MIN_HEARTBEAT - 1;

        vm.prank(ownerAddr);
        vm.expectRevert(InvalidHeartbeat.selector);
        factory.createEstate(tooShort, policyOf(ApprovalRule.AnyOne));
    }

    function test_FactoryStillEnforcesApprovalPolicyValidation() public {
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidApprovalPolicy.selector);
        factory.createEstate(defaultSettings(DistributionMode.ApprovalRequired), defaultPolicy(0));
    }

    // A factory-created estate behaves exactly like a hand-deployed one.
    function test_FactoryCreatedEstateCompletesFullLifecycle() public {
        vm.prank(ownerAddr);
        (address e, address v) =
            factory.createEstate(defaultSettings(DistributionMode.Automatic), policyOf(ApprovalRule.AnyOne));

        Estate estate = Estate(e);
        EstateVault vault = EstateVault(payable(v));

        vm.startPrank(ownerAddr);
        estate.addBeneficiary(ben1, 6000);
        estate.addBeneficiary(ben2, 4000);
        vm.stopPrank();

        assertTrue(estate.isFullyConfigured());

        vm.deal(stranger, 10 ether);
        vm.prank(stranger);
        (bool ok,) = address(vault).call{value: 10 ether}("");
        assertTrue(ok);

        warpPastGrace();
        vault.distribute();

        vm.prank(ben1);
        vault.claim();
        vm.prank(ben2);
        vault.claim();

        assertEq(ben1.balance, 6 ether);
        assertEq(ben2.balance, 4 ether);
        assertEq(uint8(estate.getState()), uint8(Estate.EstateState.Distributed));
    }

    // Testnet factories run identical contract code and differ only by the
    // limits passed at deploy time - there is no environment flag anywhere.
    function test_TestnetFactoryAllowsOneDayPeriods() public {
        EstateFactory testnet = new EstateFactory(
            EstateLimits({
                minHeartbeat: 1 days,
                maxHeartbeat: 5 * 365 days,
                minGrace: 1 days,
                maxGrace: 365 days,
                minApprovalWindow: 1 days,
                maxApprovalWindow: 365 days
            })
        );

        EstateSettings memory fast =
            EstateSettings({heartbeatInterval: 1 days, gracePeriod: 1 days, mode: DistributionMode.Automatic});

        vm.prank(ownerAddr);
        (address e,) = testnet.createEstate(fast, policyOf(ApprovalRule.AnyOne));

        assertEq(Estate(e).MIN_HEARTBEAT(), 1 days);
        assertEq(Estate(e).heartbeatExpiresAt(), block.timestamp + 1 days);

        // The production factory rejects exactly the same settings.
        vm.prank(ownerAddr);
        vm.expectRevert(InvalidHeartbeat.selector);
        factory.createEstate(fast, policyOf(ApprovalRule.AnyOne));
    }

    function test_EstateInheritsFactoryLimits() public {
        (Estate estate,) = _create(ownerAddr);

        assertEq(estate.MIN_HEARTBEAT(), PLATFORM_MIN_HEARTBEAT);
        assertEq(estate.MAX_HEARTBEAT(), PLATFORM_MAX_HEARTBEAT);
        assertEq(estate.MIN_GRACE(), PLATFORM_MIN_GRACE);
        assertEq(estate.MIN_APPROVAL_WINDOW(), PLATFORM_MIN_APPROVAL_WINDOW);
    }

    function test_FactoryRejectsIncoherentLimits() public {
        vm.expectRevert(InvalidLimits.selector);
        new EstateFactory(
            EstateLimits({
                minHeartbeat: 30 days,
                maxHeartbeat: 1 days, // min > max
                minGrace: 7 days,
                maxGrace: 365 days,
                minApprovalWindow: 7 days,
                maxApprovalWindow: 365 days
            })
        );

        vm.expectRevert(InvalidLimits.selector);
        new EstateFactory(
            EstateLimits({
                minHeartbeat: 0, // zero
                maxHeartbeat: 365 days,
                minGrace: 7 days,
                maxGrace: 365 days,
                minApprovalWindow: 7 days,
                maxApprovalWindow: 365 days
            })
        );
    }
}
