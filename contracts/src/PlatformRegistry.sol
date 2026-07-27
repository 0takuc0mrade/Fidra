// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PlatformRegistry
/// @notice Manages approved platforms for Fidra v1 instant payouts.
/// @dev Platforms are registered by governance (owner), each with a settlement wallet,
///      credit limit, reserve balance, and configurable advance fee.
contract PlatformRegistry is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE_BPS = 3_000;

    struct Platform {
        address settlementWallet;
        bool active;
        uint256 creditLimit;
        uint256 outstandingExposure;
        uint256 reserveBalance;
        uint256 advanceFeeBps;
    }

    // --- Errors ---

    error ZeroAddress();
    error ZeroAmount();
    error InvalidFeeBps(uint256 feeBps);
    error PlatformNotFound(uint256 platformId);
    error PlatformNotActive(uint256 platformId);
    error PlatformAlreadyActive(uint256 platformId);
    error CreditLimitExceeded(uint256 platformId, uint256 newExposure, uint256 creditLimit);
    error InsufficientReserve(uint256 platformId, uint256 requested, uint256 available);
    error NotAuthorizedVault(address caller);
    error VaultAlreadySet();
    error VaultNotSet();
    error ZeroCreditLimit();
    error CreditLimitBelowExposure(uint256 platformId, uint256 newLimit, uint256 currentExposure);
    error WithdrawExceedsReserve(uint256 platformId, uint256 requested, uint256 available);
    error NotPlatformWallet(uint256 platformId, address caller);
    error InvalidReserveDeposit(uint256 expected, uint256 received);

    // --- Events ---

    event PlatformRegistered(
        uint256 indexed platformId, address indexed settlementWallet, uint256 creditLimit, uint256 advanceFeeBps
    );
    event PlatformUpdated(
        uint256 indexed platformId, address indexed settlementWallet, uint256 creditLimit, uint256 advanceFeeBps
    );
    event PlatformPaused(uint256 indexed platformId);
    event PlatformUnpaused(uint256 indexed platformId);
    event ReserveDeposited(uint256 indexed platformId, address indexed depositor, uint256 amount);
    event ReserveWithdrawn(uint256 indexed platformId, address indexed recipient, uint256 amount);
    event VaultAuthorized(address indexed vault);
    event ExposureIncreased(uint256 indexed platformId, uint256 amount, uint256 newExposure);
    event ExposureDecreased(uint256 indexed platformId, uint256 amount, uint256 newExposure);
    event ReserveDrawn(uint256 indexed platformId, uint256 requested, uint256 drawn);
    event PlatformAutoPaused(uint256 indexed platformId);
    event SettlementOperatorUpdated(uint256 indexed platformId, address indexed operator, bool authorized);

    // --- State ---

    IERC20 public immutable usdc;
    address public authorizedVault;
    uint256 public totalAccountedReserves;

    uint256 private _nextPlatformId = 1;
    mapping(uint256 platformId => Platform platform) private _platforms;
    mapping(uint256 platformId => mapping(address operator => bool authorized)) private _settlementOperators;

    // --- Constructor ---

    constructor(IERC20 usdc_) Ownable(msg.sender) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    // --- Owner: vault authorization ---

    /// @notice Sets the only vault allowed to mutate exposure and draw reserves.
    /// @dev One-time setter. Cannot be changed after initial configuration.
    function setAuthorizedVault(address vault) external onlyOwner {
        if (authorizedVault != address(0)) revert VaultAlreadySet();
        if (vault == address(0)) revert ZeroAddress();
        authorizedVault = vault;
        emit VaultAuthorized(vault);
    }

    // --- Owner: platform management ---

    /// @notice Registers a new platform.
    function registerPlatform(address settlementWallet, uint256 creditLimit, uint256 advanceFeeBps)
        external
        onlyOwner
        returns (uint256 platformId)
    {
        if (settlementWallet == address(0)) revert ZeroAddress();
        if (creditLimit == 0) revert ZeroCreditLimit();
        if (advanceFeeBps > MAX_FEE_BPS) revert InvalidFeeBps(advanceFeeBps);

        platformId = _nextPlatformId++;
        _platforms[platformId] = Platform({
            settlementWallet: settlementWallet,
            active: true,
            creditLimit: creditLimit,
            outstandingExposure: 0,
            reserveBalance: 0,
            advanceFeeBps: advanceFeeBps
        });

        emit PlatformRegistered(platformId, settlementWallet, creditLimit, advanceFeeBps);
    }

    /// @notice Updates a platform's configuration.
    function updatePlatform(uint256 platformId, address settlementWallet, uint256 creditLimit, uint256 advanceFeeBps)
        external
        onlyOwner
    {
        Platform storage platform = _requirePlatform(platformId);
        if (settlementWallet == address(0)) revert ZeroAddress();
        if (creditLimit == 0) revert ZeroCreditLimit();
        if (creditLimit < platform.outstandingExposure) {
            revert CreditLimitBelowExposure(platformId, creditLimit, platform.outstandingExposure);
        }
        if (advanceFeeBps > MAX_FEE_BPS) revert InvalidFeeBps(advanceFeeBps);

        platform.settlementWallet = settlementWallet;
        platform.creditLimit = creditLimit;
        platform.advanceFeeBps = advanceFeeBps;

        emit PlatformUpdated(platformId, settlementWallet, creditLimit, advanceFeeBps);
    }

    /// @notice Pauses a platform, preventing new certifications and advances.
    function pausePlatform(uint256 platformId) external onlyOwner {
        Platform storage platform = _requirePlatform(platformId);
        if (!platform.active) revert PlatformNotActive(platformId);
        platform.active = false;
        emit PlatformPaused(platformId);
    }

    /// @notice Reactivates a paused platform.
    function unpausePlatform(uint256 platformId) external onlyOwner {
        Platform storage platform = _requirePlatform(platformId);
        if (platform.active) revert PlatformAlreadyActive(platformId);
        platform.active = true;
        emit PlatformUnpaused(platformId);
    }

    /// @notice Allows a platform settlement wallet to authorize or revoke a settlement delegate.
    /// @dev Authorization remains manageable while paused so existing obligations can be repaid.
    function setSettlementOperator(uint256 platformId, address operator, bool authorized) external {
        Platform storage platform = _requirePlatform(platformId);
        if (msg.sender != platform.settlementWallet) {
            revert NotPlatformWallet(platformId, msg.sender);
        }
        if (operator == address(0)) revert ZeroAddress();
        _settlementOperators[platformId][operator] = authorized;
        emit SettlementOperatorUpdated(platformId, operator, authorized);
    }

    /// @notice Deposits USDC reserve for a platform.
    function depositReserve(uint256 platformId, uint256 amount) external onlyOwner nonReentrant {
        Platform storage platform = _requirePlatform(platformId);
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert InvalidReserveDeposit(amount, received);

        platform.reserveBalance += amount;
        totalAccountedReserves += amount;
        emit ReserveDeposited(platformId, msg.sender, amount);
    }

    /// @notice Withdraws USDC reserve for a platform.
    function withdrawReserve(uint256 platformId, uint256 amount) external onlyOwner nonReentrant {
        Platform storage platform = _requirePlatform(platformId);
        if (amount == 0) revert ZeroAmount();
        if (amount > platform.reserveBalance) {
            revert WithdrawExceedsReserve(platformId, amount, platform.reserveBalance);
        }

        platform.reserveBalance -= amount;
        totalAccountedReserves -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit ReserveWithdrawn(platformId, msg.sender, amount);
    }

    // --- Vault-only: exposure and reserve management ---

    /// @notice Increases a platform's outstanding exposure. Reverts if credit limit would be breached.
    function increaseExposure(uint256 platformId, uint256 amount) external {
        _requireVault();
        Platform storage platform = _requirePlatform(platformId);
        if (!platform.active) revert PlatformNotActive(platformId);
        if (platform.reserveBalance == 0) {
            revert InsufficientReserve(platformId, 1, 0);
        }

        uint256 newExposure = platform.outstandingExposure + amount;
        if (newExposure > platform.creditLimit) {
            revert CreditLimitExceeded(platformId, newExposure, platform.creditLimit);
        }

        platform.outstandingExposure = newExposure;
        emit ExposureIncreased(platformId, amount, newExposure);
    }

    /// @notice Decreases a platform's outstanding exposure after settlement.
    function decreaseExposure(uint256 platformId, uint256 amount) external {
        _requireVault();
        Platform storage platform = _requirePlatform(platformId);
        platform.outstandingExposure -= amount;
        emit ExposureDecreased(platformId, amount, platform.outstandingExposure);
    }

    /// @notice Draws from a platform's reserve to cover a default. Returns the actual amount drawn.
    function drawReserve(uint256 platformId, uint256 amount) external nonReentrant returns (uint256 drawn) {
        _requireVault();
        Platform storage platform = _requirePlatform(platformId);

        drawn = amount > platform.reserveBalance ? platform.reserveBalance : amount;
        if (drawn > 0) {
            platform.reserveBalance -= drawn;
            totalAccountedReserves -= drawn;
            usdc.safeTransfer(msg.sender, drawn);
        }
        emit ReserveDrawn(platformId, amount, drawn);
    }

    /// @notice Automatically pauses a platform on default. Called by the vault.
    function autoPause(uint256 platformId) external {
        _requireVault();
        Platform storage platform = _requirePlatform(platformId);
        platform.active = false;
        emit PlatformAutoPaused(platformId);
    }

    // --- Views ---

    function getPlatform(uint256 platformId) external view returns (Platform memory) {
        return _requirePlatform(platformId);
    }

    function isPlatformActive(uint256 platformId) external view returns (bool) {
        return _requirePlatform(platformId).active;
    }

    function availableCredit(uint256 platformId) external view returns (uint256) {
        Platform storage platform = _requirePlatform(platformId);
        return platform.creditLimit - platform.outstandingExposure;
    }

    function isAuthorizedSettlementPayer(uint256 platformId, address payer) external view returns (bool) {
        Platform storage platform = _requirePlatform(platformId);
        return payer == platform.settlementWallet || _settlementOperators[platformId][payer];
    }

    function actualReserveCash() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function reserveCashSurplus() external view returns (uint256) {
        uint256 actual = actualReserveCash();
        return actual > totalAccountedReserves ? actual - totalAccountedReserves : 0;
    }

    function reserveCashDeficit() external view returns (uint256) {
        uint256 actual = actualReserveCash();
        return totalAccountedReserves > actual ? totalAccountedReserves - actual : 0;
    }

    function isReserveCashReconciled() external view returns (bool) {
        return actualReserveCash() == totalAccountedReserves;
    }

    // --- Internal ---

    function _requirePlatform(uint256 platformId) private view returns (Platform storage platform) {
        platform = _platforms[platformId];
        if (platform.settlementWallet == address(0)) revert PlatformNotFound(platformId);
    }

    function _requireVault() private view {
        if (msg.sender != authorizedVault) revert NotAuthorizedVault(msg.sender);
    }
}
