// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ------------------------------------------------------------
// Access control
// ------------------------------------------------------------

error NotOwner();
error InvalidOwner();
error NotApprover();
error NotVault();

// ------------------------------------------------------------
// Heartbeat & grace period
// ------------------------------------------------------------

error InvalidHeartbeat();
error InvalidGracePeriod();
error HeartbeatExpired();

// ------------------------------------------------------------
// Beneficiaries
// ------------------------------------------------------------

error InvalidBeneficiary();
error DuplicateBeneficiary();
error AllocationExceeds100Percent();
error NoRecipients();
error ResiduaryBeneficiaryRequired();

// ------------------------------------------------------------
// Approvers & approval flow
// ------------------------------------------------------------

error InvalidApprover();
error OwnerCannotApprove();
error ApproversNotUsed();
error DuplicateApprover();
error AlreadyApproved();
error ApprovalRequired();
error ApprovalWindowExpired();
error InvalidApprovalPolicy();
error InvalidApprovalWindow();
error InvalidLimits();
error TooManyApprovers();

// ------------------------------------------------------------
// Vault & distribution
// ------------------------------------------------------------

error InvalidVault();
error VaultAlreadySet();
error VaultNotSet();
error EstateNotConfigured();
error DistributionNotReady();
error DistributionAlreadyCompleted();
error DistributionFailed();
error NothingToDistribute();
error WithdrawalFailed();
error NothingToClaim();
