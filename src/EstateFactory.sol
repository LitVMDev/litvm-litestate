// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./Estate.sol";
import "./EstateVault.sol";
import "./Types.sol";
import "./Errors.sol";

/// @notice Platform entry point. Deployed once per chain; every user creates
/// their own estate through it with their own settings.
///
/// Creating an estate and its vault in a single transaction means the two can
/// never be left unwired - the "forgot to call setVault()" failure mode is
/// structurally impossible for factory-created estates.
contract EstateFactory {
    // ------------------------------------------------------------
    // Events
    // ------------------------------------------------------------

    event EstateCreated(address indexed owner, address indexed estate, address indexed vault);

    // ------------------------------------------------------------
    // State
    // ------------------------------------------------------------

    mapping(address => address[]) private _estatesByOwner;
    address[] private _allEstates;

    // Fixed for the life of this factory and applied to every estate it
    // creates. Production and testnet run identical contract code and differ
    // only by the values passed here at deploy time.
    uint256 public immutable minHeartbeat;
    uint256 public immutable maxHeartbeat;
    uint256 public immutable minGrace;
    uint256 public immutable maxGrace;
    uint256 public immutable minApprovalWindow;
    uint256 public immutable maxApprovalWindow;

    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------

    constructor(EstateLimits memory _limits) {
        // Estate validates these too; failing here means a misconfigured
        // factory cannot be deployed at all rather than producing estates
        // that revert on creation.
        if (
            _limits.minHeartbeat == 0 || _limits.minHeartbeat > _limits.maxHeartbeat || _limits.minGrace == 0
                || _limits.minGrace > _limits.maxGrace || _limits.minApprovalWindow == 0
                || _limits.minApprovalWindow > _limits.maxApprovalWindow
        ) {
            revert InvalidLimits();
        }

        minHeartbeat = _limits.minHeartbeat;
        maxHeartbeat = _limits.maxHeartbeat;
        minGrace = _limits.minGrace;
        maxGrace = _limits.maxGrace;
        minApprovalWindow = _limits.minApprovalWindow;
        maxApprovalWindow = _limits.maxApprovalWindow;
    }

    /// The limits every estate from this factory is bound by. Exposed as a
    /// struct so a UI can read them all in one call.
    function limits() public view returns (EstateLimits memory) {
        return EstateLimits({
            minHeartbeat: minHeartbeat,
            maxHeartbeat: maxHeartbeat,
            minGrace: minGrace,
            maxGrace: maxGrace,
            minApprovalWindow: minApprovalWindow,
            maxApprovalWindow: maxApprovalWindow
        });
    }

    // ------------------------------------------------------------
    // Creation
    // ------------------------------------------------------------

    /// @param settings The caller's own heartbeat interval, grace period and
    /// distribution mode. Validated against Estate's platform constants.
    /// @param approvalPolicy The caller's own approval rule and window.
    /// @return estate The new estate, owned by msg.sender.
    /// @return vault The new vault, already linked to the estate.
    function createEstate(EstateSettings calldata settings, ApprovalPolicy calldata approvalPolicy)
        external
        returns (address estate, address vault)
    {
        Estate newEstate = new Estate(msg.sender, settings, approvalPolicy, limits());
        EstateVault newVault = new EstateVault(address(newEstate));

        // Permitted because the factory is the estate's deployer.
        newEstate.setVault(address(newVault));

        estate = address(newEstate);
        vault = address(newVault);

        _estatesByOwner[msg.sender].push(estate);
        _allEstates.push(estate);

        emit EstateCreated(msg.sender, estate, vault);
    }

    // ------------------------------------------------------------
    // Registry views
    // ------------------------------------------------------------

    // Lets the front end find a user's estates without scanning event logs.
    function estatesOf(address owner) external view returns (address[] memory) {
        return _estatesByOwner[owner];
    }

    function estateCountOf(address owner) external view returns (uint256) {
        return _estatesByOwner[owner].length;
    }

    function allEstates() external view returns (address[] memory) {
        return _allEstates;
    }

    function totalEstates() external view returns (uint256) {
        return _allEstates.length;
    }
}
