// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PlatformRegistry} from "./PlatformRegistry.sol";

/// @title EarningsManager
/// @notice Manages worker earnings claims for Fidra v1.
/// @dev Platforms create and certify claims. The authorized vault marks claims as advanced/settled.
///      Certified claims are immutable and cannot be revoked.
contract EarningsManager is Ownable {
    enum ClaimStatus {
        None,
        Pending,
        Certified,
        Cancelled,
        Advanced,
        Settled
    }

    struct Claim {
        uint256 platformId;
        address worker;
        uint256 faceValue;
        uint64 dueDate;
        bytes32 taskHash;
        bytes32 evidenceHash;
        ClaimStatus status;
    }

    // --- Errors ---

    error ZeroAddress();
    error ZeroAmount();
    error ZeroDueDate();
    error ZeroTaskHash();
    error ZeroEvidenceHash();
    error DueDateInPast(uint64 dueDate);
    error ClaimNotFound(uint256 claimId);
    error InvalidClaimStatus(uint256 claimId, ClaimStatus actual);
    error NotPlatformWallet(uint256 platformId, address caller);
    error PlatformNotActive(uint256 platformId);
    error TaskHashAlreadyUsed(uint256 platformId, bytes32 taskHash);
    error NotAuthorizedVault(address caller);
    error VaultAlreadySet();

    // --- Events ---

    event ClaimCreated(
        uint256 indexed claimId,
        uint256 indexed platformId,
        address indexed worker,
        uint256 faceValue,
        uint64 dueDate,
        bytes32 taskHash,
        bytes32 evidenceHash
    );
    event ClaimCertified(uint256 indexed claimId, uint256 indexed platformId);
    event ClaimCancelled(uint256 indexed claimId, uint256 indexed platformId);
    event ClaimAdvanced(uint256 indexed claimId);
    event ClaimSettled(uint256 indexed claimId);
    event VaultAuthorized(address indexed vault);

    // --- State ---

    PlatformRegistry public immutable registry;
    address public authorizedVault;

    uint256 private _nextClaimId = 1;
    mapping(uint256 claimId => Claim claim) private _claims;
    /// @dev Per-platform task hash deduplication.
    mapping(uint256 platformId => mapping(bytes32 taskHash => bool used)) private _usedTaskHashes;

    // --- Constructor ---

    constructor(PlatformRegistry registry_) Ownable(msg.sender) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    // --- Owner: vault authorization ---

    /// @notice Sets the only vault allowed to mark claims as advanced or settled.
    function setAuthorizedVault(address vault) external onlyOwner {
        if (authorizedVault != address(0)) revert VaultAlreadySet();
        if (vault == address(0)) revert ZeroAddress();
        authorizedVault = vault;
        emit VaultAuthorized(vault);
    }

    // --- Platform: claim lifecycle ---

    /// @notice Creates a new earnings claim in Pending status.
    /// @dev Only callable by the registered settlement wallet of an active platform.
    function createClaim(
        uint256 platformId,
        address worker,
        uint256 faceValue,
        uint64 dueDate,
        bytes32 taskHash,
        bytes32 evidenceHash
    ) external returns (uint256 claimId) {
        _requireActivePlatformWallet(platformId);
        if (worker == address(0)) revert ZeroAddress();
        if (faceValue == 0) revert ZeroAmount();
        if (dueDate == 0) revert ZeroDueDate();
        if (dueDate <= uint64(block.timestamp)) revert DueDateInPast(dueDate);
        if (taskHash == bytes32(0)) revert ZeroTaskHash();
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        if (_usedTaskHashes[platformId][taskHash]) revert TaskHashAlreadyUsed(platformId, taskHash);

        _usedTaskHashes[platformId][taskHash] = true;
        claimId = _nextClaimId++;
        _claims[claimId] = Claim({
            platformId: platformId,
            worker: worker,
            faceValue: faceValue,
            dueDate: dueDate,
            taskHash: taskHash,
            evidenceHash: evidenceHash,
            status: ClaimStatus.Pending
        });

        emit ClaimCreated(claimId, platformId, worker, faceValue, dueDate, taskHash, evidenceHash);
    }

    /// @notice Certifies a pending claim, making it eligible for advance and immutable.
    function certifyClaim(uint256 claimId) external {
        Claim storage claim = _requireClaim(claimId);
        if (claim.status != ClaimStatus.Pending) revert InvalidClaimStatus(claimId, claim.status);
        _requireActivePlatformWallet(claim.platformId);

        claim.status = ClaimStatus.Certified;
        emit ClaimCertified(claimId, claim.platformId);
    }

    /// @notice Cancels a pending claim. Only allowed before certification.
    function cancelClaim(uint256 claimId) external {
        Claim storage claim = _requireClaim(claimId);
        if (claim.status != ClaimStatus.Pending) revert InvalidClaimStatus(claimId, claim.status);
        _requirePlatformWallet(claim.platformId);

        claim.status = ClaimStatus.Cancelled;
        emit ClaimCancelled(claimId, claim.platformId);
    }

    // --- Vault-only: state transitions ---

    /// @notice Marks a certified claim as advanced (purchased by the vault).
    function markAdvanced(uint256 claimId) external {
        _requireVault();
        Claim storage claim = _requireClaim(claimId);
        if (claim.status != ClaimStatus.Certified) revert InvalidClaimStatus(claimId, claim.status);
        claim.status = ClaimStatus.Advanced;
        emit ClaimAdvanced(claimId);
    }

    /// @notice Marks an advanced claim as settled.
    function markSettled(uint256 claimId) external {
        _requireVault();
        Claim storage claim = _requireClaim(claimId);
        if (claim.status != ClaimStatus.Advanced) revert InvalidClaimStatus(claimId, claim.status);
        claim.status = ClaimStatus.Settled;
        emit ClaimSettled(claimId);
    }

    // --- Views ---

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _requireClaim(claimId);
    }

    function isTaskHashUsed(uint256 platformId, bytes32 taskHash) external view returns (bool) {
        return _usedTaskHashes[platformId][taskHash];
    }

    // --- Internal ---

    function _requireClaim(uint256 claimId) private view returns (Claim storage claim) {
        claim = _claims[claimId];
        if (claim.status == ClaimStatus.None) revert ClaimNotFound(claimId);
    }

    function _requireActivePlatformWallet(uint256 platformId) private view {
        PlatformRegistry.Platform memory platform = registry.getPlatform(platformId);
        if (!platform.active) revert PlatformNotActive(platformId);
        if (msg.sender != platform.settlementWallet) revert NotPlatformWallet(platformId, msg.sender);
    }

    function _requirePlatformWallet(uint256 platformId) private view {
        PlatformRegistry.Platform memory platform = registry.getPlatform(platformId);
        if (msg.sender != platform.settlementWallet) revert NotPlatformWallet(platformId, msg.sender);
    }

    function _requireVault() private view {
        if (msg.sender != authorizedVault) revert NotAuthorizedVault(msg.sender);
    }
}
