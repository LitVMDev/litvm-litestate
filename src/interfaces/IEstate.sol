// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../Types.sol";

interface IEstate {
    // ------------------------------------------------------------
    // Views used by the vault
    // ------------------------------------------------------------

    function owner() external view returns (address);

    function canDistribute() external view returns (bool);

    function totalAllocatedBps() external view returns (uint16);

    function residuaryBeneficiary() external view returns (address);

    // Whether the estate could actually complete a distribution today.
    function isFullyConfigured() external view returns (bool);

    // Single-call payout set - avoids per-beneficiary external calls.
    function getActiveBeneficiaries() external view returns (Beneficiary[] memory);

    // ------------------------------------------------------------
    // Vault-only calls
    // ------------------------------------------------------------

    function markDistributed() external;
}
