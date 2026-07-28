// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../Types.sol";

// Generic asset-vault surface for a future estate that could hold more than
// one vault type. EstateVault does not currently declare `is IAssetVault`
// (it takes deposits via `receive()` rather than an explicit `deposit()`),
// so this interface isn't wired up to anything yet.
interface IAssetVault {
    function deposit() external payable;

    function distribute() external;

    function balance() external view returns (uint256);
}
