// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PlatformRegistry} from "./PlatformRegistry.sol";
import {EarningsManager} from "./EarningsManager.sol";

/// @title AdvanceVaultV2
/// @notice Fidra v1 liquidity vault for instant worker payouts.
/// @dev Workers sell certified earnings claims to the vault for discounted USDC.
///      Platforms are responsible for settlement. Missed settlement draws reserves and pauses the platform.
contract AdvanceVaultV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Purchase {
        uint256 claimId;
        uint256 platformId;
        address worker;
        uint256 faceValue;
        uint256 advanceAmount;
        uint256 fee;
        uint64 dueDate;
        uint64 purchasedAt;
        bool settled;
    }

    struct VaultStats {
        uint256 availableLiquidity;
        uint256 totalAdvanced;
        uint256 totalOutstanding;
        uint256 totalSettled;
        uint256 totalRealizedSpread;
    }

    // --- Errors ---

    error ZeroAddress();
    error ZeroAmount();
    error IncorrectDepositAmount(uint256 expected, uint256 received);
    error InsufficientLiquidity(uint256 required, uint256 available);
    error WithdrawExceedsAvailable(uint256 requested, uint256 available);
    error ClaimNotCertified(uint256 claimId, EarningsManager.ClaimStatus actual);
    error NotClaimWorker(uint256 claimId, address expected, address caller);
    error ClaimAlreadyPurchased(uint256 claimId);
    error PlatformNotActive(uint256 platformId);
    error ClaimNotAdvanced(uint256 claimId, EarningsManager.ClaimStatus actual);
    error ClaimAlreadySettled(uint256 claimId);
    error SettlementNotReceived(uint256 claimId, uint256 expected, uint256 actual);
    error ClaimNotPastDue(uint256 claimId, uint64 dueDate, uint64 currentTime);
    error ClaimNotPurchased(uint256 claimId);

    // --- Events ---

    event LiquidityDeposited(address indexed depositor, uint256 amount);
    event LiquidityWithdrawn(address indexed recipient, uint256 amount);
    event AdvancePurchased(
        uint256 indexed claimId,
        uint256 indexed platformId,
        address indexed worker,
        uint256 faceValue,
        uint256 advanceAmount,
        uint256 fee
    );
    event ClaimSettledEvent(
        uint256 indexed claimId, uint256 indexed platformId, uint256 faceValue, uint256 realizedSpread
    );
    event DefaultTriggered(
        uint256 indexed claimId, uint256 indexed platformId, uint256 reserveDrawn, uint256 shortfall
    );

    // --- State ---

    IERC20 public immutable usdc;
    PlatformRegistry public immutable registry;
    EarningsManager public immutable earnings;

    uint256 private _availableLiquidity;
    uint256 public totalAdvanced;
    uint256 public totalOutstanding;
    uint256 public totalSettled;
    uint256 public totalRealizedSpread;

    mapping(uint256 claimId => Purchase purchase) private _purchases;

    // --- Constructor ---

    constructor(address usdc_, address registry_, address earnings_) Ownable(msg.sender) {
        if (usdc_ == address(0) || registry_ == address(0) || earnings_ == address(0)) {
            revert ZeroAddress();
        }
        usdc = IERC20(usdc_);
        registry = PlatformRegistry(registry_);
        earnings = EarningsManager(earnings_);
    }

    // --- Owner: liquidity management ---

    /// @notice Deposits USDC liquidity into the vault.
    function depositLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert IncorrectDepositAmount(amount, received);

        _availableLiquidity += amount;
        emit LiquidityDeposited(msg.sender, amount);
    }

    /// @notice Withdraws excess USDC liquidity from the vault.
    function withdrawLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > _availableLiquidity) revert WithdrawExceedsAvailable(amount, _availableLiquidity);

        _availableLiquidity -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    // --- Worker: purchase advance ---

    /// @notice Worker sells a certified claim to the vault for instant USDC.
    /// @dev Only the worker named in the claim may call this.
    function purchaseAdvance(uint256 claimId) external nonReentrant {
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);

        if (claim.status != EarningsManager.ClaimStatus.Certified) {
            revert ClaimNotCertified(claimId, claim.status);
        }
        if (msg.sender != claim.worker) revert NotClaimWorker(claimId, claim.worker, msg.sender);
        if (_purchases[claimId].worker != address(0)) revert ClaimAlreadyPurchased(claimId);

        PlatformRegistry.Platform memory platform = registry.getPlatform(claim.platformId);
        if (!platform.active) revert PlatformNotActive(claim.platformId);

        uint256 fee = Math.mulDiv(claim.faceValue, platform.advanceFeeBps, BPS_DENOMINATOR);
        uint256 advanceAmount = claim.faceValue - fee;
        if (advanceAmount == 0) revert ZeroAmount();
        if (advanceAmount > _availableLiquidity) {
            revert InsufficientLiquidity(advanceAmount, _availableLiquidity);
        }

        _purchases[claimId] = Purchase({
            claimId: claimId,
            platformId: claim.platformId,
            worker: claim.worker,
            faceValue: claim.faceValue,
            advanceAmount: advanceAmount,
            fee: fee,
            dueDate: claim.dueDate,
            purchasedAt: uint64(block.timestamp),
            settled: false
        });

        _availableLiquidity -= advanceAmount;
        totalAdvanced += advanceAmount;
        totalOutstanding += claim.faceValue;

        registry.increaseExposure(claim.platformId, claim.faceValue);
        earnings.markAdvanced(claimId);

        usdc.safeTransfer(claim.worker, advanceAmount);

        emit AdvancePurchased(claimId, claim.platformId, claim.worker, claim.faceValue, advanceAmount, fee);
    }

    // --- Settlement ---

    /// @notice Settles a purchased claim. Transfers face value from caller to vault.
    /// @dev Anyone may call, but the USDC must arrive. Typically called by the platform.
    function settleClaim(uint256 claimId) external nonReentrant {
        Purchase storage purchase = _requirePurchase(claimId);
        if (purchase.settled) revert ClaimAlreadySettled(claimId);

        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        if (claim.status != EarningsManager.ClaimStatus.Advanced) {
            revert ClaimNotAdvanced(claimId, claim.status);
        }

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), purchase.faceValue);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != purchase.faceValue) {
            revert SettlementNotReceived(claimId, purchase.faceValue, received);
        }

        purchase.settled = true;
        totalOutstanding -= purchase.faceValue;
        totalSettled += purchase.faceValue;
        totalRealizedSpread += purchase.fee;
        _availableLiquidity += purchase.faceValue;

        registry.decreaseExposure(purchase.platformId, purchase.faceValue);
        earnings.markSettled(claimId);

        emit ClaimSettledEvent(claimId, purchase.platformId, purchase.faceValue, purchase.fee);
    }

    // --- Default ---

    /// @notice Triggers a default on a purchased claim past its due date.
    /// @dev Draws from the platform's reserve. Pauses the platform. Permissionless after due date.
    function triggerDefault(uint256 claimId) external nonReentrant {
        Purchase storage purchase = _requirePurchase(claimId);
        if (purchase.settled) revert ClaimAlreadySettled(claimId);
        if (uint64(block.timestamp) <= purchase.dueDate) {
            revert ClaimNotPastDue(claimId, purchase.dueDate, uint64(block.timestamp));
        }

        uint256 drawn = registry.drawReserve(purchase.platformId, purchase.faceValue);

        purchase.settled = true;
        totalOutstanding -= purchase.faceValue;
        totalSettled += purchase.faceValue;
        _availableLiquidity += drawn;

        uint256 shortfall = purchase.faceValue - drawn;
        if (drawn >= purchase.fee) {
            totalRealizedSpread += purchase.fee;
        } else {
            totalRealizedSpread += drawn;
        }

        registry.decreaseExposure(purchase.platformId, purchase.faceValue);
        registry.autoPause(purchase.platformId);
        earnings.markSettled(claimId);

        emit DefaultTriggered(claimId, purchase.platformId, drawn, shortfall);
    }

    // --- Views ---

    function getPurchase(uint256 claimId) external view returns (Purchase memory) {
        return _purchases[claimId];
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        return balance < _availableLiquidity ? balance : _availableLiquidity;
    }

    function vaultStats() external view returns (VaultStats memory) {
        return VaultStats({
            availableLiquidity: availableLiquidity(),
            totalAdvanced: totalAdvanced,
            totalOutstanding: totalOutstanding,
            totalSettled: totalSettled,
            totalRealizedSpread: totalRealizedSpread
        });
    }

    // --- Internal ---

    function _requirePurchase(uint256 claimId) private view returns (Purchase storage purchase) {
        purchase = _purchases[claimId];
        if (purchase.worker == address(0)) revert ClaimNotPurchased(claimId);
    }
}
