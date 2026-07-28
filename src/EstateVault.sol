// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IEstate.sol";
import "./Errors.sol";

contract EstateVault is ReentrancyGuard {
    // ------------------------------------------------------------
    // Events
    // ------------------------------------------------------------

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Distributed(uint256 amount);
    event ClaimCreated(address indexed beneficiary, uint256 amount);
    event Claimed(address indexed beneficiary, uint256 amount);

    // ------------------------------------------------------------
    // State
    // ------------------------------------------------------------

    IEstate public immutable estate;

    bool public distributed;

    // Pull-payment ledger populated by distribute() - beneficiaries withdraw
    // their own share via claim() rather than being pushed funds directly, so
    // one bad/reverting recipient can't block payouts to everyone else.
    mapping(address => uint256) public claimable;
    uint256 public totalClaimable;

    // ------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != estate.owner()) {
            revert NotOwner();
        }
        _;
    }

    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------

    constructor(address estateAddress) {
        if (estateAddress == address(0)) {
            revert InvalidVault();
        }

        estate = IEstate(estateAddress);
    }

    // ------------------------------------------------------------
    // Deposits
    // ------------------------------------------------------------

    // Deposits are refused until the estate could actually pay out: it needs
    // at least one recipient, and an approval quorum its approvers can
    // physically reach. Funding an estate whose Threshold exceeds the number
    // of approvers ever added would otherwise lock the funds permanently,
    // even with every approver willing to sign.
    receive() external payable {
        if (distributed) {
            revert DistributionAlreadyCompleted();
        }

        if (!estate.isFullyConfigured()) {
            revert EstateNotConfigured();
        }

        emit Deposited(msg.sender, msg.value);
    }

    function balance() public view returns (uint256) {
        return address(this).balance;
    }

    // ------------------------------------------------------------
    // Owner withdrawal (pre-distribution only)
    // ------------------------------------------------------------

    // The owner keeps full control of their own funds right up until the
    // estate is actually distributed. A living owner can always reclaim
    // everything; nothing on-chain can distinguish that from a compromised
    // key, so custody of the owner key remains the security boundary.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (distributed) {
            revert DistributionAlreadyCompleted();
        }

        if (amount > address(this).balance) {
            revert WithdrawalFailed();
        }

        (bool success,) = payable(msg.sender).call{value: amount}("");

        if (!success) {
            revert WithdrawalFailed();
        }

        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------
    // Distribution
    // ------------------------------------------------------------

    function distribute() external nonReentrant {
        if (distributed) {
            revert DistributionAlreadyCompleted();
        }

        if (!estate.canDistribute()) {
            revert DistributionNotReady();
        }

        uint256 vaultBalance = address(this).balance;

        // Refuse to burn the one-shot distribution on an empty vault, which
        // would otherwise brick the estate for anyone who funds it later.
        if (vaultBalance == 0) {
            revert NothingToDistribute();
        }

        Beneficiary[] memory list = estate.getActiveBeneficiaries();
        address residuary = estate.residuaryBeneficiary();

        if (list.length == 0 && residuary == address(0)) {
            revert NoRecipients();
        }

        distributed = true;

        uint256 allocated;

        // Shares are literal percentages of the vault: 2_500 bps pays 25% of
        // the balance regardless of what the other beneficiaries hold.
        for (uint256 i = 0; i < list.length; i++) {
            uint256 amount = (vaultBalance * list[i].shareBps) / 10_000;

            allocated += amount;

            claimable[list[i].wallet] += amount;

            emit ClaimCreated(list[i].wallet, amount);
        }

        uint256 remainder = vaultBalance - allocated;

        if (remainder > 0) {
            // Whatever the owner left unallocated goes to the residuary
            // beneficiary. An estate cannot be funded while shares total under
            // 100% without one, so when none is set the remainder here is only
            // rounding dust from the divisions above - at most one wei per
            // beneficiary - which goes to the first of them.
            address recipient = residuary != address(0) ? residuary : list[0].wallet;

            claimable[recipient] += remainder;

            emit ClaimCreated(recipient, remainder);
        }

        totalClaimable = vaultBalance;

        estate.markDistributed();

        emit Distributed(vaultBalance);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];

        if (amount == 0) {
            revert NothingToClaim();
        }

        claimable[msg.sender] = 0;
        totalClaimable -= amount;

        (bool success,) = payable(msg.sender).call{value: amount}("");

        if (!success) {
            revert DistributionFailed();
        }

        emit Claimed(msg.sender, amount);
    }
}
