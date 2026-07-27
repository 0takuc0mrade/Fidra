// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MandateManager
/// @notice Escrows USDC for controlled agent purchases and turns locked spends into receivables.
/// @dev All amounts are denominated in the 6-decimal units of Arc's ERC-20 USDC interface.
contract MandateManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint64 public constant MAX_RELEASE_DELAY_SECONDS = 365 days;

    enum MandateStatus {
        None,
        Active,
        Revoked
    }

    enum RequestStatus {
        None,
        Requested,
        Approved,
        Locked,
        Released,
        Rejected
    }

    struct Mandate {
        address business;
        address agent;
        address approver;
        uint256 totalBudget;
        uint256 reserved;
        uint256 spent;
        uint64 expiresAt;
        uint64 defaultReleaseDelaySeconds;
        uint256 maxPerPurchase;
        bool proofRequired;
        MandateStatus status;
        bytes32 metadataHash;
    }

    struct SpendRequest {
        uint256 mandateId;
        address agent;
        address vendor;
        address payee;
        uint256 amount;
        bytes32 proofHash;
        bytes32 externalRefHash;
        RequestStatus status;
        uint64 createdAt;
        uint64 approvedAt;
        uint64 lockedAt;
        uint64 releaseDueAt;
        uint64 releasedAt;
        bool advanceAssigned;
    }

    error ZeroAddress();
    error ZeroAmount();
    error ZeroExternalRefHash();
    error ZeroProofHash();
    error InvalidExpiry();
    error InvalidReleaseDelay(uint64 releaseDelaySeconds);
    error InvalidMaxPerPurchase();
    error NoAllowedVendors();
    error MandateNotFound(uint256 mandateId);
    error SpendRequestNotFound(uint256 spendId);
    error NotMandateBusiness(uint256 mandateId, address caller);
    error NotMandateAgent(uint256 mandateId, address caller);
    error NotMandateApprover(uint256 mandateId, address caller);
    error NotProofSubmitter(uint256 spendId, address caller);
    error MandateNotActive(uint256 mandateId);
    error MandateExpired(uint256 mandateId);
    error MandateNotReclaimable(uint256 mandateId);
    error VendorNotAllowed(uint256 mandateId, address vendor);
    error AmountExceedsMaxPerPurchase(uint256 amount, uint256 maximum);
    error InsufficientAvailableBudget(uint256 requested, uint256 available);
    error ExternalRefAlreadyUsed(bytes32 externalRefHash);
    error InvalidRequestStatus(uint256 spendId, RequestStatus actual);
    error ProofRequired(uint256 spendId);
    error NothingToReclaim(uint256 mandateId);
    error IncorrectFundingAmount(uint256 expected, uint256 received);
    error NotCurrentPayee(uint256 spendId, address caller);
    error NotAuthorizedAdvanceVault(address caller);
    error AuthorizedAdvanceVaultNotSet();
    error AuthorizedAdvanceVaultAlreadyFrozen();
    error CurrentPayeeMismatch(uint256 spendId, address expected, address actual);
    error AdvancePayeeMustBeVault(address vault, address newPayee);
    error ClaimAlreadyAdvanced(uint256 spendId);

    event MandateCreated(
        uint256 indexed mandateId,
        address indexed business,
        address indexed agent,
        address approver,
        uint256 totalBudget,
        uint64 expiresAt,
        bytes32 metadataHash
    );
    event SpendRequested(
        uint256 indexed spendId,
        uint256 indexed mandateId,
        address indexed vendor,
        address agent,
        address payee,
        uint256 amount,
        bytes32 externalRefHash
    );
    event ProofSubmitted(uint256 indexed spendId, bytes32 indexed proofHash, address indexed submitter);
    event SpendApproved(uint256 indexed spendId, uint256 indexed mandateId, address indexed approver);
    event SpendLocked(uint256 indexed spendId, uint256 indexed mandateId, uint256 amount, uint64 releaseDueAt);
    event SpendRejected(uint256 indexed spendId, uint256 indexed mandateId, address indexed rejector);
    event SpendReleased(uint256 indexed spendId, uint256 indexed mandateId, address indexed payee, uint256 amount);
    event MandateRevoked(uint256 indexed mandateId, address indexed business);
    event ExpiredFundsReclaimed(uint256 indexed mandateId, address indexed business, uint256 amount);
    event ClaimAssigned(uint256 indexed spendId, address indexed oldPayee, address indexed newPayee);
    event AdvanceVaultUpdated(address indexed oldAdvanceVault, address indexed newAdvanceVault);
    event AuthorizedAdvanceVaultFrozen(address indexed vault);

    IERC20 public immutable usdc;
    address public authorizedAdvanceVault;
    bool public authorizedVaultFrozen;

    uint256 private _nextMandateId = 1;
    uint256 private _nextSpendId = 1;

    mapping(uint256 mandateId => Mandate mandate) private _mandates;
    mapping(uint256 spendId => SpendRequest request) private _spendRequests;
    mapping(uint256 mandateId => mapping(address vendor => bool allowed)) private _allowedVendors;
    mapping(bytes32 externalRefHash => bool used) private _usedExternalRefs;

    constructor(IERC20 usdc_) Ownable(msg.sender) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    /// @notice Updates the only vault allowed to atomically purchase and take assignment of claims.
    /// @dev This is a one-step owner trust boundary until freezeAuthorizedAdvanceVault permanently closes rotation.
    function setAuthorizedAdvanceVault(address newAdvanceVault) external onlyOwner {
        if (authorizedVaultFrozen) revert AuthorizedAdvanceVaultAlreadyFrozen();
        if (newAdvanceVault == address(0)) revert ZeroAddress();
        address oldAdvanceVault = authorizedAdvanceVault;
        authorizedAdvanceVault = newAdvanceVault;
        emit AdvanceVaultUpdated(oldAdvanceVault, newAdvanceVault);
    }

    /// @notice Permanently freezes the configured vault used for atomic claim purchases.
    /// @dev The frozen vault remains authorized; only future rotation is disabled.
    function freezeAuthorizedAdvanceVault() external onlyOwner {
        if (authorizedVaultFrozen) revert AuthorizedAdvanceVaultAlreadyFrozen();
        address vault = authorizedAdvanceVault;
        if (vault == address(0)) revert AuthorizedAdvanceVaultNotSet();

        authorizedVaultFrozen = true;
        emit AuthorizedAdvanceVaultFrozen(vault);
    }

    /// @notice Creates and fully funds a new agent spending mandate.
    function createMandate(
        address agent,
        address approver,
        uint256 totalBudget,
        uint64 expiresAt,
        uint64 defaultReleaseDelaySeconds,
        uint256 maxPerPurchase,
        bool proofRequired,
        bytes32 metadataHash,
        address[] calldata allowedVendors
    ) external nonReentrant returns (uint256 mandateId) {
        if (agent == address(0) || approver == address(0)) revert ZeroAddress();
        if (totalBudget == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (defaultReleaseDelaySeconds == 0 || defaultReleaseDelaySeconds > MAX_RELEASE_DELAY_SECONDS) {
            revert InvalidReleaseDelay(defaultReleaseDelaySeconds);
        }
        if (maxPerPurchase == 0 || maxPerPurchase > totalBudget) revert InvalidMaxPerPurchase();
        if (allowedVendors.length == 0) revert NoAllowedVendors();

        mandateId = _nextMandateId++;
        Mandate storage mandate = _mandates[mandateId];
        mandate.business = msg.sender;
        mandate.agent = agent;
        mandate.approver = approver;
        mandate.totalBudget = totalBudget;
        mandate.expiresAt = expiresAt;
        mandate.defaultReleaseDelaySeconds = defaultReleaseDelaySeconds;
        mandate.maxPerPurchase = maxPerPurchase;
        mandate.proofRequired = proofRequired;
        mandate.status = MandateStatus.Active;
        mandate.metadataHash = metadataHash;

        for (uint256 i; i < allowedVendors.length; ++i) {
            address vendor = allowedVendors[i];
            if (vendor == address(0)) revert ZeroAddress();
            _allowedVendors[mandateId][vendor] = true;
        }

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), totalBudget);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != totalBudget) revert IncorrectFundingAmount(totalBudget, received);

        _emitMandateCreated(mandateId, mandate);
    }

    /// @notice Submits a vendor spend request without reserving funds yet.
    function requestSpend(uint256 mandateId, address vendor, uint256 amount, bytes32 externalRefHash)
        external
        returns (uint256 spendId)
    {
        Mandate storage mandate = _requireMandate(mandateId);
        if (msg.sender != mandate.agent) revert NotMandateAgent(mandateId, msg.sender);
        _requireActiveAndUnexpired(mandateId, mandate);
        if (!_allowedVendors[mandateId][vendor]) revert VendorNotAllowed(mandateId, vendor);
        if (amount == 0) revert ZeroAmount();
        if (amount > mandate.maxPerPurchase) {
            revert AmountExceedsMaxPerPurchase(amount, mandate.maxPerPurchase);
        }

        uint256 available = _availableBudget(mandate);
        if (amount > available) revert InsufficientAvailableBudget(amount, available);
        if (externalRefHash == bytes32(0)) revert ZeroExternalRefHash();
        if (_usedExternalRefs[externalRefHash]) revert ExternalRefAlreadyUsed(externalRefHash);

        _usedExternalRefs[externalRefHash] = true;
        spendId = _nextSpendId++;
        _spendRequests[spendId] = SpendRequest({
            mandateId: mandateId,
            agent: msg.sender,
            vendor: vendor,
            payee: vendor,
            amount: amount,
            proofHash: bytes32(0),
            externalRefHash: externalRefHash,
            status: RequestStatus.Requested,
            createdAt: uint64(block.timestamp),
            approvedAt: 0,
            lockedAt: 0,
            releaseDueAt: 0,
            releasedAt: 0,
            advanceAssigned: false
        });

        emit SpendRequested(spendId, mandateId, vendor, msg.sender, vendor, amount, externalRefHash);
    }

    /// @notice Attaches or updates evidence before a spend is locked.
    function submitProof(uint256 spendId, bytes32 proofHash) external {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        if (spend.status != RequestStatus.Requested && spend.status != RequestStatus.Approved) {
            revert InvalidRequestStatus(spendId, spend.status);
        }
        if (proofHash == bytes32(0)) revert ZeroProofHash();

        Mandate storage mandate = _mandates[spend.mandateId];
        if (msg.sender != spend.vendor && msg.sender != spend.agent && msg.sender != mandate.approver) {
            revert NotProofSubmitter(spendId, msg.sender);
        }

        spend.proofHash = proofHash;
        emit ProofSubmitted(spendId, proofHash, msg.sender);
    }

    /// @notice Records approval; funds are not reserved until lockSpend succeeds.
    function approveSpend(uint256 spendId) external {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        Mandate storage mandate = _mandates[spend.mandateId];
        _requireApproverOrBusiness(spend.mandateId, mandate);
        if (spend.status != RequestStatus.Requested) {
            revert InvalidRequestStatus(spendId, spend.status);
        }
        if (mandate.proofRequired && spend.proofHash == bytes32(0)) revert ProofRequired(spendId);

        spend.status = RequestStatus.Approved;
        spend.approvedAt = uint64(block.timestamp);
        emit SpendApproved(spendId, spend.mandateId, msg.sender);
    }

    /// @notice Reserves the approved face amount and creates an irrevocable receivable.
    function lockSpend(uint256 spendId) external {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        Mandate storage mandate = _mandates[spend.mandateId];
        _requireApproverOrBusiness(spend.mandateId, mandate);
        if (spend.status != RequestStatus.Approved) {
            revert InvalidRequestStatus(spendId, spend.status);
        }
        _requireActiveAndUnexpired(spend.mandateId, mandate);

        uint256 available = _availableBudget(mandate);
        if (spend.amount > available) revert InsufficientAvailableBudget(spend.amount, available);

        mandate.reserved += spend.amount;
        spend.status = RequestStatus.Locked;
        spend.lockedAt = uint64(block.timestamp);
        spend.releaseDueAt = uint64(block.timestamp) + mandate.defaultReleaseDelaySeconds;
        emit SpendLocked(spendId, spend.mandateId, spend.amount, spend.releaseDueAt);
    }

    /// @notice Rejects a spend only before it becomes a locked receivable.
    function rejectSpend(uint256 spendId) external {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        Mandate storage mandate = _mandates[spend.mandateId];
        _requireApproverOrBusiness(spend.mandateId, mandate);
        if (spend.status != RequestStatus.Requested && spend.status != RequestStatus.Approved) {
            revert InvalidRequestStatus(spendId, spend.status);
        }

        spend.status = RequestStatus.Rejected;
        emit SpendRejected(spendId, spend.mandateId, msg.sender);
    }

    /// @notice Assigns a locked receivable directly to a new claim owner.
    /// @dev The original vendor remains fixed; only the mutable settlement payee changes.
    function assignClaim(uint256 spendId, address newPayee) external {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        if (spend.status != RequestStatus.Locked) {
            revert InvalidRequestStatus(spendId, spend.status);
        }
        if (msg.sender != spend.payee) revert NotCurrentPayee(spendId, msg.sender);
        _assignClaim(spendId, spend, newPayee);
    }

    /// @notice Lets the authorized AdvanceVault atomically buy and take assignment of a locked claim.
    /// @dev expectedCurrentPayee prevents a stale or front-run purchase from assigning the wrong seller's claim.
    function assignClaimForAdvance(uint256 spendId, address expectedCurrentPayee, address newPayee) external {
        if (msg.sender != authorizedAdvanceVault) revert NotAuthorizedAdvanceVault(msg.sender);

        SpendRequest storage spend = _requireSpendRequest(spendId);
        if (spend.status != RequestStatus.Locked) {
            revert InvalidRequestStatus(spendId, spend.status);
        }
        if (spend.payee != expectedCurrentPayee) {
            revert CurrentPayeeMismatch(spendId, expectedCurrentPayee, spend.payee);
        }
        if (spend.advanceAssigned) revert ClaimAlreadyAdvanced(spendId);
        if (newPayee == address(0)) revert ZeroAddress();
        if (newPayee != msg.sender) revert AdvancePayeeMustBeVault(msg.sender, newPayee);
        spend.advanceAssigned = true;
        _assignClaim(spendId, spend, newPayee);
    }

    /// @notice Pays a locked spend to its current claim owner.
    /// @dev Business/approver may release early; at releaseDueAt anyone may enforce settlement.
    function releaseSpend(uint256 spendId) external nonReentrant {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        Mandate storage mandate = _mandates[spend.mandateId];
        if (spend.status != RequestStatus.Locked) {
            revert InvalidRequestStatus(spendId, spend.status);
        }
        if (block.timestamp < spend.releaseDueAt) {
            _requireApproverOrBusiness(spend.mandateId, mandate);
        }

        // This permissionless deadline turns a Locked claim into a live receivable rather than a
        // discretionary promise. Parent mandate state and expiry intentionally cannot impair it.
        mandate.reserved -= spend.amount;
        mandate.spent += spend.amount;
        spend.status = RequestStatus.Released;
        spend.releasedAt = uint64(block.timestamp);

        address payee = spend.payee;
        usdc.safeTransfer(payee, spend.amount);
        emit SpendReleased(spendId, spend.mandateId, payee, spend.amount);
    }

    /// @notice Stops future locks without changing any already-locked spend.
    function revokeMandate(uint256 mandateId) external {
        Mandate storage mandate = _requireMandate(mandateId);
        if (msg.sender != mandate.business) revert NotMandateBusiness(mandateId, msg.sender);
        if (mandate.status != MandateStatus.Active) revert MandateNotActive(mandateId);

        mandate.status = MandateStatus.Revoked;
        emit MandateRevoked(mandateId, msg.sender);
    }

    /// @notice Returns a revoked or expired mandate's uncommitted USDC to its business.
    function reclaimExpired(uint256 mandateId) external nonReentrant returns (uint256 reclaimable) {
        Mandate storage mandate = _requireMandate(mandateId);
        if (msg.sender != mandate.business) revert NotMandateBusiness(mandateId, msg.sender);
        if (mandate.status != MandateStatus.Revoked && block.timestamp < mandate.expiresAt) {
            revert MandateNotReclaimable(mandateId);
        }

        reclaimable = _availableBudget(mandate);
        if (reclaimable == 0) revert NothingToReclaim(mandateId);

        // Reclaim reduces only unreserved budget. The reserved balance is excluded so this action
        // can never impair the full USDC backing of an already-Locked receivable.
        mandate.totalBudget -= reclaimable;
        usdc.safeTransfer(mandate.business, reclaimable);
        emit ExpiredFundsReclaimed(mandateId, mandate.business, reclaimable);
    }

    function getMandate(uint256 mandateId) external view returns (Mandate memory) {
        Mandate storage mandate = _requireMandate(mandateId);
        return mandate;
    }

    function getSpendRequest(uint256 spendId) external view returns (SpendRequest memory) {
        SpendRequest storage spend = _requireSpendRequest(spendId);
        return spend;
    }

    function isVendorAllowed(uint256 mandateId, address vendor) external view returns (bool) {
        _requireMandate(mandateId);
        return _allowedVendors[mandateId][vendor];
    }

    function availableBudget(uint256 mandateId) external view returns (uint256) {
        Mandate storage mandate = _requireMandate(mandateId);
        return _availableBudget(mandate);
    }

    function _availableBudget(Mandate storage mandate) private view returns (uint256) {
        return mandate.totalBudget - mandate.spent - mandate.reserved;
    }

    function _assignClaim(uint256 spendId, SpendRequest storage spend, address newPayee) private {
        if (newPayee == address(0)) revert ZeroAddress();

        address oldPayee = spend.payee;
        spend.payee = newPayee;
        emit ClaimAssigned(spendId, oldPayee, newPayee);
    }

    function _emitMandateCreated(uint256 mandateId, Mandate storage mandate) private {
        emit MandateCreated(
            mandateId,
            mandate.business,
            mandate.agent,
            mandate.approver,
            mandate.totalBudget,
            mandate.expiresAt,
            mandate.metadataHash
        );
    }

    function _requireMandate(uint256 mandateId) private view returns (Mandate storage mandate) {
        mandate = _mandates[mandateId];
        if (mandate.status == MandateStatus.None) revert MandateNotFound(mandateId);
    }

    function _requireSpendRequest(uint256 spendId) private view returns (SpendRequest storage spend) {
        spend = _spendRequests[spendId];
        if (spend.status == RequestStatus.None) revert SpendRequestNotFound(spendId);
    }

    function _requireApproverOrBusiness(uint256 mandateId, Mandate storage mandate) private view {
        if (msg.sender != mandate.approver && msg.sender != mandate.business) {
            revert NotMandateApprover(mandateId, msg.sender);
        }
    }

    function _requireActiveAndUnexpired(uint256 mandateId, Mandate storage mandate) private view {
        if (mandate.status != MandateStatus.Active) revert MandateNotActive(mandateId);
        if (block.timestamp >= mandate.expiresAt) revert MandateExpired(mandateId);
    }
}
