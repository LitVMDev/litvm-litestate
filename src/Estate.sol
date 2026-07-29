// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "./Types.sol";
import "./Errors.sol";

contract Estate {
    // ------------------------------------------------------------
    // Types
    // ------------------------------------------------------------

    enum EstateState {
        Active,
        GracePeriod,
        AwaitingApproval,
        ReadyForDistribution,
        Distributed
    }

    struct EstateInfo {
        EstateState state;
        uint256 lastCheckIn;
        uint256 heartbeatEnds;
        uint256 graceEnds;
        uint256 approvalEnds;
        uint16 beneficiaryCount;
        uint16 approverCount;
        uint16 approvalCount;
        uint16 requiredApprovals;
        uint16 totalAllocatedBps;
        address residuaryBeneficiary;
        bool fullyConfigured;
    }

    // ------------------------------------------------------------
    // Events
    // ------------------------------------------------------------

    event CheckedIn(address indexed owner, uint256 timestamp);

    event BeneficiaryAdded(uint256 indexed id, address indexed wallet, uint16 shareBps);
    event BeneficiaryUpdated(uint256 indexed id, uint16 shareBps);
    event BeneficiaryRemoved(uint256 indexed id);
    event ResiduaryBeneficiarySet(address indexed wallet);

    event ApproverAdded(uint256 indexed id, address indexed wallet);
    event ApproverRemoved(uint256 indexed id);

    event DistributionApproved(address indexed approver);
    event EstateReadyForDistribution();
    event DistributionCompleted();

    event VaultSet(address indexed vault);

    event HeartbeatUpdated(uint256 interval);
    event GracePeriodUpdated(uint256 period);

    // ------------------------------------------------------------
    // Limits
    // ------------------------------------------------------------
    //
    // Time bounds come from the deploying factory and are fixed for the life
    // of this estate. Every estate created by a given factory shares them, so
    // they remain platform policy rather than a per-user choice - while still
    // letting a testnet factory use shorter periods than a production one,
    // with no runtime environment flag anywhere in the contract.

    uint256 public immutable MIN_HEARTBEAT;
    uint256 public immutable MAX_HEARTBEAT;

    uint256 public immutable MIN_GRACE;
    uint256 public immutable MAX_GRACE;

    uint256 public immutable MIN_APPROVAL_WINDOW;
    uint256 public immutable MAX_APPROVAL_WINDOW;

    // Genuinely universal, so it stays a constant.
    uint8 public constant MAX_APPROVERS = 5;

    // ------------------------------------------------------------
    // State - core
    // ------------------------------------------------------------

    address public immutable owner;

    // Whoever deployed this estate - the factory, or the owner on a direct
    // deployment. Permitted to call setVault() once so the factory can wire
    // estate and vault atomically at creation.
    address private immutable deployer;

    uint256 public lastCheckIn;

    EstateSettings public settings;

    address public vault;

    // Only ever false -> true, set by the vault once payouts are recorded.
    // Deliberately private: read the lifecycle through getState(), which also
    // accounts for the heartbeat/grace/approval clocks.
    bool private _distributed;

    // ------------------------------------------------------------
    // State - beneficiaries
    // ------------------------------------------------------------

    mapping(uint256 => Beneficiary) private beneficiaries;
    mapping(address => uint256) private beneficiaryIdByAddress;

    // Active ids only - removal swap-and-pops, so this never accumulates dead
    // entries and distribution cost stays proportional to live beneficiaries.
    uint256[] private beneficiaryIds;
    mapping(uint256 => uint256) private beneficiaryIndexPlusOne;

    uint256 private nextBeneficiaryId = 1;

    uint16 public totalAllocatedBps;

    // Receives whatever share of the vault is left unallocated (the residuary
    // estate). Required whenever shares total under 100% - see
    // isFullyConfigured() - so the remainder always has a named destination
    // rather than falling to whichever beneficiary happens to be stored last.
    address public residuaryBeneficiary;

    // ------------------------------------------------------------
    // State - approvers & approval policy
    // ------------------------------------------------------------

    mapping(uint256 => Approver) private approvers;
    mapping(address => uint256) private approverIdByAddress;
    uint256[] private approverIds;
    uint256 private nextApproverId = 1;

    uint16 public activeApproverCount;

    ApprovalPolicy public approvalPolicy;
    uint16 public approvalCount;

    // ------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // Blocks beneficiary/approver management once the heartbeat has lapsed.
    // Stricter than onlyBeforeDistributionPhase: management stops as soon as
    // GracePeriod begins, not only once grace fully expires.
    modifier onlyWhileActive() {
        if (heartbeatExpired()) {
            revert HeartbeatExpired();
        }
        _;
    }

    // Blocks checkIn() only once the estate has actually concluded the owner is
    // gone. While it is still *asking* - AwaitingApproval, including after the
    // approval window has closed - a signature from the owner is proof the
    // premise is false, so they may still rebut it.
    modifier onlyBeforeDistributionIsDue() {
        EstateState current = getState();

        if (current == EstateState.ReadyForDistribution || current == EstateState.Distributed) {
            revert DistributionNotReady();
        }
        _;
    }

    modifier onlyActiveApprover() {
        uint256 id = approverIdByAddress[msg.sender];

        if (id == 0 || !approvers[id].active) {
            revert NotApprover();
        }
        _;
    }

    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------

    constructor(
        address _owner,
        EstateSettings memory _settings,
        ApprovalPolicy memory _approvalPolicy,
        EstateLimits memory _limits
    ) {
        if (_owner == address(0)) {
            revert InvalidOwner();
        }

        if (
            _limits.minHeartbeat == 0 || _limits.minHeartbeat > _limits.maxHeartbeat || _limits.minGrace == 0
                || _limits.minGrace > _limits.maxGrace || _limits.minApprovalWindow == 0
                || _limits.minApprovalWindow > _limits.maxApprovalWindow
        ) {
            revert InvalidLimits();
        }

        MIN_HEARTBEAT = _limits.minHeartbeat;
        MAX_HEARTBEAT = _limits.maxHeartbeat;
        MIN_GRACE = _limits.minGrace;
        MAX_GRACE = _limits.maxGrace;
        MIN_APPROVAL_WINDOW = _limits.minApprovalWindow;
        MAX_APPROVAL_WINDOW = _limits.maxApprovalWindow;

        owner = _owner;
        deployer = msg.sender;
        lastCheckIn = block.timestamp;

        settings = _settings;
        approvalPolicy = _approvalPolicy;

        _validateTimeSettings();
        _validateApprovalPolicyConfig();
    }

    // ------------------------------------------------------------
    // Heartbeat & grace period
    // ------------------------------------------------------------

    function checkIn() external onlyOwner onlyBeforeDistributionIsDue {
        lastCheckIn = block.timestamp;

        // Approvals CAN exist here: an owner may check in while the estate is
        // AwaitingApproval, rebutting a release already part-way through. Clear
        // them, or a later lapse would resume from a stale count and release on
        // fewer fresh approvals than the policy requires.
        //
        // Guarded so an ordinary check-in - by far the common case, and the one
        // action that must never feel expensive - pays nothing for this.
        if (approvalCount > 0) {
            uint256 total = approverIds.length;

            for (uint256 i = 0; i < total; i++) {
                Approver storage approver = approvers[approverIds[i]];

                if (approver.approved) {
                    approver.approved = false;
                }
            }

            approvalCount = 0;
        }

        emit CheckedIn(owner, lastCheckIn);
    }

    function updateHeartbeat(uint256 interval) external onlyOwner onlyWhileActive {
        settings.heartbeatInterval = interval;

        _validateTimeSettings();

        // The new interval counts from now, not from the previous check-in.
        //
        // heartbeatExpiresAt() is lastCheckIn + interval, so leaving lastCheckIn
        // alone would move the deadline backwards whenever the interval is
        // shortened - far enough, into the past, taking a healthy estate
        // straight through GracePeriod into distribution with no way back.
        //
        // Restarting the clock is also the honest reading of the action:
        // calling this requires the owner's signature, which is exactly the
        // evidence a check-in provides. It matches what "check in every N days"
        // plainly means, and grants no power the owner lacks already, since
        // they could call checkIn() immediately beforehand.
        lastCheckIn = block.timestamp;

        emit HeartbeatUpdated(interval);
        emit CheckedIn(owner, lastCheckIn);
    }

    function updateGracePeriod(uint256 period) external onlyOwner onlyWhileActive {
        settings.gracePeriod = period;

        _validateTimeSettings();

        emit GracePeriodUpdated(period);
    }

    function heartbeatExpiresAt() public view returns (uint256) {
        return lastCheckIn + settings.heartbeatInterval;
    }

    function graceEndsAt() public view returns (uint256) {
        return heartbeatExpiresAt() + settings.gracePeriod;
    }

    function heartbeatExpired() public view returns (bool) {
        return block.timestamp >= heartbeatExpiresAt();
    }

    function graceExpired() public view returns (bool) {
        return block.timestamp >= graceEndsAt();
    }

    function _validateTimeSettings() internal view {
        if (settings.heartbeatInterval < MIN_HEARTBEAT || settings.heartbeatInterval > MAX_HEARTBEAT) {
            revert InvalidHeartbeat();
        }

        if (settings.gracePeriod < MIN_GRACE || settings.gracePeriod > MAX_GRACE) {
            revert InvalidGracePeriod();
        }
    }

    // ------------------------------------------------------------
    // Beneficiary management
    // ------------------------------------------------------------

    function addBeneficiary(address wallet, uint16 shareBps) external onlyOwner onlyWhileActive {
        // The owner may never inherit their own estate.
        if (wallet == address(0) || wallet == owner) {
            revert InvalidBeneficiary();
        }

        if (beneficiaryIdByAddress[wallet] != 0) {
            revert DuplicateBeneficiary();
        }

        if (shareBps == 0) {
            revert InvalidBeneficiary();
        }

        // Widened to uint256 so an oversized share reports the intended error
        // instead of tripping a raw arithmetic panic.
        if (uint256(totalAllocatedBps) + uint256(shareBps) > 10_000) {
            revert AllocationExceeds100Percent();
        }

        uint256 id = nextBeneficiaryId++;

        beneficiaries[id] = Beneficiary({id: id, wallet: wallet, shareBps: shareBps, active: true});

        beneficiaryIds.push(id);
        beneficiaryIndexPlusOne[id] = beneficiaryIds.length;
        beneficiaryIdByAddress[wallet] = id;
        totalAllocatedBps += shareBps;

        emit BeneficiaryAdded(id, wallet, shareBps);
    }

    function updateBeneficiary(uint256 id, uint16 newShareBps) external onlyOwner onlyWhileActive {
        Beneficiary storage beneficiary = beneficiaries[id];

        if (!beneficiary.active) {
            revert InvalidBeneficiary();
        }

        if (newShareBps == 0) {
            revert InvalidBeneficiary();
        }

        uint256 newTotal = uint256(totalAllocatedBps) - uint256(beneficiary.shareBps) + uint256(newShareBps);

        if (newTotal > 10_000) {
            revert AllocationExceeds100Percent();
        }

        totalAllocatedBps = uint16(newTotal);
        beneficiary.shareBps = newShareBps;

        _requireConfiguredIfFunded();

        emit BeneficiaryUpdated(id, newShareBps);
    }

    function removeBeneficiary(uint256 id) external onlyOwner onlyWhileActive {
        Beneficiary storage beneficiary = beneficiaries[id];

        if (!beneficiary.active) {
            revert InvalidBeneficiary();
        }

        totalAllocatedBps -= beneficiary.shareBps;

        beneficiaryIdByAddress[beneficiary.wallet] = 0;
        beneficiary.active = false;

        _removeBeneficiaryId(id);
        _requireConfiguredIfFunded();

        emit BeneficiaryRemoved(id);
    }

    // Swap-and-pop so beneficiaryIds only ever holds live entries.
    function _removeBeneficiaryId(uint256 id) private {
        uint256 index = beneficiaryIndexPlusOne[id] - 1;
        uint256 lastIndex = beneficiaryIds.length - 1;

        if (index != lastIndex) {
            uint256 movedId = beneficiaryIds[lastIndex];
            beneficiaryIds[index] = movedId;
            beneficiaryIndexPlusOne[movedId] = index + 1;
        }

        beneficiaryIds.pop();
        beneficiaryIndexPlusOne[id] = 0;
    }

    // Nominates who receives any portion of the vault the owner left
    // unallocated. Pass address(0) to clear.
    function setResiduaryBeneficiary(address wallet) external onlyOwner onlyWhileActive {
        if (wallet == owner) {
            revert InvalidBeneficiary();
        }

        residuaryBeneficiary = wallet;

        _requireConfiguredIfFunded();

        emit ResiduaryBeneficiarySet(wallet);
    }

    function beneficiaryCount() external view returns (uint256) {
        return beneficiaryIds.length;
    }

    function getBeneficiary(uint256 id) external view returns (Beneficiary memory) {
        return beneficiaries[id];
    }

    function getBeneficiaryIds() external view returns (uint256[] memory) {
        return beneficiaryIds;
    }

    // Batch accessor so the vault can read the whole payout set in a single
    // external call rather than two calls per beneficiary.
    function getActiveBeneficiaries() external view returns (Beneficiary[] memory list) {
        list = new Beneficiary[](beneficiaryIds.length);

        for (uint256 i = 0; i < beneficiaryIds.length; i++) {
            list[i] = beneficiaries[beneficiaryIds[i]];
        }
    }

    // ------------------------------------------------------------
    // Approver management
    // ------------------------------------------------------------

    function addApprover(address wallet) external onlyOwner onlyWhileActive {
        // An Automatic estate has no use for approvers and never will: the mode
        // is fixed at construction, requiredApprovals() is always 0, and
        // getState() skips AwaitingApproval entirely, so approveDistribution()
        // could never succeed for whoever was added. Refuse rather than take
        // the owner's gas for a role that does nothing and reads, to both the
        // owner and the person named, as though it does.
        if (settings.mode != DistributionMode.ApprovalRequired) {
            revert ApproversNotUsed();
        }

        if (wallet == address(0)) {
            revert InvalidApprover();
        }

        // The owner must never be an approver. Approval only becomes relevant
        // once the owner has stopped checking in, so an estate whose quorum
        // depends on them could only ever be approved by someone who is, by
        // the premise of this contract, no longer around.
        if (wallet == owner) {
            revert OwnerCannotApprove();
        }

        if (approverIdByAddress[wallet] != 0) {
            revert DuplicateApprover();
        }

        if (activeApproverCount >= MAX_APPROVERS) {
            revert TooManyApprovers();
        }

        uint256 id = nextApproverId++;
        approverIdByAddress[wallet] = id;
        approvers[id] = Approver({id: id, wallet: wallet, approved: false, active: true});

        approverIds.push(id);
        activeApproverCount++;

        emit ApproverAdded(id, wallet);
    }

    function removeApprover(uint256 id) external onlyOwner onlyWhileActive {
        Approver storage approver = approvers[id];

        if (!approver.active) {
            revert NotApprover();
        }

        // approver.approved is always false here: onlyWhileActive requires
        // !heartbeatExpired(), while approveDistribution() only succeeds once
        // grace has fully expired (which requires heartbeatExpired()).

        approverIdByAddress[approver.wallet] = 0;
        approver.active = false;
        activeApproverCount--;

        _validateApprovalPolicy();

        emit ApproverRemoved(id);
    }

    function approverCount() external view returns (uint256) {
        return activeApproverCount;
    }

    function getApprover(uint256 id) external view returns (Approver memory) {
        return approvers[id];
    }

    // Every approver id ever issued, including removed ones.
    function getApproverIds() external view returns (uint256[] memory) {
        return approverIds;
    }

    // Config-time checks that don't depend on how many approvers exist yet.
    function _validateApprovalPolicyConfig() internal view {
        if (settings.mode != DistributionMode.ApprovalRequired) {
            return;
        }

        if (approvalPolicy.approvalWindow < MIN_APPROVAL_WINDOW || approvalPolicy.approvalWindow > MAX_APPROVAL_WINDOW)
        {
            revert InvalidApprovalWindow();
        }

        if (approvalPolicy.rule == ApprovalRule.Threshold) {
            if (approvalPolicy.threshold == 0 || approvalPolicy.threshold > MAX_APPROVERS) {
                revert InvalidApprovalPolicy();
            }
        }
    }

    // True once this estate could actually complete a distribution: it has at
    // least one recipient, and (in ApprovalRequired mode) a quorum that the
    // approvers who exist are physically able to reach.
    //
    // The vault refuses deposits until this holds, which is what stops an
    // owner from funding an estate whose Threshold exceeds the number of
    // approvers they ever added - a configuration that would otherwise lock
    // the funds forever, even with every approver willing to sign.
    //
    // This stays true once funded: the policy is immutable after deployment,
    // removeApprover() cannot drop below the quorum, and recipient removals
    // are blocked while the vault holds a balance.
    function isFullyConfigured() public view returns (bool) {
        if (!_hasRecipients()) {
            return false;
        }

        // Anything not allocated to a named beneficiary must have an explicit
        // destination. Without this the remainder would fall to whichever
        // beneficiary happened to be stored last, making payouts depend on the
        // order they were added and on removal history.
        if (totalAllocatedBps < 10_000 && residuaryBeneficiary == address(0)) {
            return false;
        }

        if (settings.mode == DistributionMode.Automatic) {
            return true;
        }

        if (activeApproverCount == 0) {
            return false;
        }

        // AnyOne needs 1 and All needs exactly however many exist, so only a
        // fixed Threshold can outrun the approver count.
        if (approvalPolicy.rule == ApprovalRule.Threshold && approvalPolicy.threshold > activeApproverCount) {
            return false;
        }

        return true;
    }

    function _hasRecipients() internal view returns (bool) {
        return beneficiaryIds.length > 0 || residuaryBeneficiary != address(0);
    }

    // Once the vault holds funds, no edit may leave the estate in a state it
    // could not distribute from. Covers removing the last recipient, clearing
    // the residuary while shares are under 100%, lowering a share below full
    // allocation, and removing approvers below quorum.
    function _requireConfiguredIfFunded() internal view {
        if (vault == address(0) || vault.balance == 0) {
            return;
        }

        if (!_hasRecipients()) {
            revert NoRecipients();
        }

        if (totalAllocatedBps < 10_000 && residuaryBeneficiary == address(0)) {
            revert ResiduaryBeneficiaryRequired();
        }
    }

    // Keeps removals from leaving a quorum that can never be reached.
    function _validateApprovalPolicy() internal view {
        if (settings.mode != DistributionMode.ApprovalRequired) {
            return;
        }

        if (activeApproverCount == 0) {
            revert InvalidApprovalPolicy();
        }

        if (approvalPolicy.rule == ApprovalRule.Threshold && approvalPolicy.threshold > activeApproverCount) {
            revert InvalidApprovalPolicy();
        }
    }

    // ------------------------------------------------------------
    // Distribution & approval flow
    // ------------------------------------------------------------

    // How many approvals are needed right now. AnyOne/All follow the live
    // approver count so the target can't drift out of reach.
    function requiredApprovals() public view returns (uint16) {
        if (settings.mode == DistributionMode.Automatic) {
            return 0;
        }

        if (approvalPolicy.rule == ApprovalRule.AnyOne) {
            return 1;
        }

        if (approvalPolicy.rule == ApprovalRule.All) {
            return activeApproverCount;
        }

        return approvalPolicy.threshold;
    }

    function getState() public view returns (EstateState) {
        if (_distributed) {
            return EstateState.Distributed;
        }

        if (!heartbeatExpired()) {
            return EstateState.Active;
        }

        if (!graceExpired()) {
            return EstateState.GracePeriod;
        }

        if (settings.mode == DistributionMode.Automatic) {
            return EstateState.ReadyForDistribution;
        }

        // An estate with no approvers can never satisfy an approval rule -
        // never treat that as "approved by default".
        if (activeApproverCount == 0) {
            return EstateState.AwaitingApproval;
        }

        uint16 required = requiredApprovals();

        if (required > 0 && approvalCount >= required) {
            return EstateState.ReadyForDistribution;
        }

        return EstateState.AwaitingApproval;
    }

    function canDistribute() public view returns (bool) {
        // Report honestly rather than letting the vault discover an unset
        // link only when markDistributed() reverts.
        if (vault == address(0)) {
            return false;
        }

        return getState() == EstateState.ReadyForDistribution;
    }

    function approveDistribution() external onlyActiveApprover {
        if (getState() != EstateState.AwaitingApproval) {
            revert ApprovalRequired();
        }

        if (block.timestamp > approvalEndsAt()) {
            revert ApprovalWindowExpired();
        }

        uint256 id = approverIdByAddress[msg.sender];
        Approver storage approver = approvers[id];

        if (approver.approved) {
            revert AlreadyApproved();
        }

        approver.approved = true;
        approvalCount++;

        emit DistributionApproved(msg.sender);

        if (approvalCount >= requiredApprovals()) {
            emit EstateReadyForDistribution();
        }
    }

    function approvalEndsAt() public view returns (uint256) {
        return graceEndsAt() + approvalPolicy.approvalWindow;
    }

    // ------------------------------------------------------------
    // Vault linkage
    // ------------------------------------------------------------

    // Callable by the owner, or once by the deployer so a factory can wire
    // the vault in the same transaction it creates the estate.
    function setVault(address vaultAddress) external {
        if (msg.sender != owner && msg.sender != deployer) {
            revert NotOwner();
        }

        if (vault != address(0)) {
            revert VaultAlreadySet();
        }

        if (vaultAddress == address(0)) {
            revert InvalidVault();
        }

        if (vaultAddress.code.length == 0) {
            revert InvalidVault();
        }

        vault = vaultAddress;

        emit VaultSet(vaultAddress);
    }

    // Called by the linked vault once it has actually recorded payouts, so
    // that getState() only reports Distributed after funds have been
    // distributed - not merely because someone asked the estate to say so.
    function markDistributed() external {
        if (msg.sender != vault) {
            revert NotVault();
        }

        _distributed = true;

        emit DistributionCompleted();
    }

    // ------------------------------------------------------------
    // Aggregate view
    // ------------------------------------------------------------

    function getEstateInfo() external view returns (EstateInfo memory) {
        return EstateInfo({
            state: getState(),
            lastCheckIn: lastCheckIn,
            heartbeatEnds: heartbeatExpiresAt(),
            graceEnds: graceEndsAt(),
            approvalEnds: approvalEndsAt(),
            beneficiaryCount: uint16(beneficiaryIds.length),
            approverCount: activeApproverCount,
            approvalCount: approvalCount,
            requiredApprovals: requiredApprovals(),
            totalAllocatedBps: totalAllocatedBps,
            residuaryBeneficiary: residuaryBeneficiary,
            fullyConfigured: isFullyConfigured()
        });
    }
}
