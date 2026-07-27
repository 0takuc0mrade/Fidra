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

    enum PurchaseStatus {
        None,
        Outstanding,
        Settled,
        Defaulted
    }

    struct Purchase {
        uint256 claimId;
        uint256 platformId;
        address worker;
        uint256 faceValue;
        uint256 advanceAmount;
        uint256 fee;
        uint64 dueDate;
        uint64 purchasedAt;
        uint256 platformSettlementAmount;
        uint256 reserveRecoveryAmount;
        uint256 realizedProfit;
        uint256 realizedLoss;
        uint256 contractualShortfall;
        PurchaseStatus status;
    }

    struct VaultStats {
        uint256 accountedCash;
        uint256 actualCash;
        uint256 accountedAssets;
        uint256 totalAdvancePrincipal;
        uint256 outstandingPrincipal;
        uint256 outstandingFaceValue;
        uint256 totalSettledFaceValue;
        uint256 totalDefaultRecoveries;
        uint256 totalRealizedProfit;
        uint256 totalRealizedLoss;
        uint256 totalContractualShortfall;
        uint256 totalLiquidityDeposited;
        uint256 totalLiquidityWithdrawn;
        int256 netLiquidityContributed;
    }

    // --- Errors ---

    error ZeroAddress();
    error ZeroAmount();
    error IncorrectDepositAmount(uint256 expected, uint256 received);
    error InsufficientAccountedCash(uint256 required, uint256 available);
    error InsufficientActualCash(uint256 required, uint256 available);
    error WithdrawExceedsAvailable(uint256 requested, uint256 available);
    error ClaimNotCertified(uint256 claimId, EarningsManager.ClaimStatus actual);
    error NotClaimWorker(uint256 claimId, address expected, address caller);
    error ClaimAlreadyPurchased(uint256 claimId);
    error PlatformNotActive(uint256 platformId);
    error ReserveRequirementNotMet(uint256 platformId);
    error ClaimExpired(uint256 claimId, uint64 dueDate, uint64 currentTime);
    error ClaimNotAdvanced(uint256 claimId, EarningsManager.ClaimStatus actual);
    error ClaimAlreadyResolved(uint256 claimId, PurchaseStatus status);
    error UnauthorizedSettlementPayer(uint256 platformId, address caller);
    error SettlementNotReceived(uint256 claimId, uint256 expected, uint256 actual);
    error DefaultRecoveryMismatch(uint256 claimId, uint256 expected, uint256 actual);
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
        uint256 indexed claimId, uint256 indexed platformId, uint256 faceValue, uint256 realizedProfit
    );
    event DefaultTriggered(
        uint256 indexed claimId,
        uint256 indexed platformId,
        uint256 reserveRecovery,
        uint256 realizedProfit,
        uint256 realizedLoss,
        uint256 contractualShortfall
    );

    // --- State ---

    IERC20 public immutable usdc;
    PlatformRegistry public immutable registry;
    EarningsManager public immutable earnings;

    uint256 public accountedCash;
    uint256 public totalAdvancePrincipal;
    uint256 public outstandingPrincipal;
    uint256 public outstandingFaceValue;
    uint256 public totalSettledFaceValue;
    uint256 public totalDefaultRecoveries;
    uint256 public totalRealizedProfit;
    uint256 public totalRealizedLoss;
    uint256 public totalContractualShortfall;
    uint256 public totalLiquidityDeposited;
    uint256 public totalLiquidityWithdrawn;

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

        accountedCash += amount;
        totalLiquidityDeposited += amount;
        emit LiquidityDeposited(msg.sender, amount);
    }

    /// @notice Withdraws excess USDC liquidity from the vault.
    function withdrawLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > accountedCash) revert WithdrawExceedsAvailable(amount, accountedCash);
        uint256 actual = actualCash();
        if (amount > actual) revert InsufficientActualCash(amount, actual);

        accountedCash -= amount;
        totalLiquidityWithdrawn += amount;
        usdc.safeTransfer(msg.sender, amount);
        emit LiquidityWithdrawn(msg.sender, amount);
    }

    // --- Worker: purchase advance ---

    /// @notice Worker sells a certified claim to the vault for instant USDC.
    /// @dev Only the worker named in the claim may call this.
    function purchaseAdvance(uint256 claimId) external nonReentrant {
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);

        if (_purchases[claimId].status != PurchaseStatus.None) revert ClaimAlreadyPurchased(claimId);
        if (claim.status != EarningsManager.ClaimStatus.Certified) {
            revert ClaimNotCertified(claimId, claim.status);
        }
        if (msg.sender != claim.worker) revert NotClaimWorker(claimId, claim.worker, msg.sender);
        if (claim.dueDate <= uint64(block.timestamp)) {
            revert ClaimExpired(claimId, claim.dueDate, uint64(block.timestamp));
        }

        PlatformRegistry.Platform memory platform = registry.getPlatform(claim.platformId);
        if (!platform.active) revert PlatformNotActive(claim.platformId);
        if (platform.reserveBalance == 0) revert ReserveRequirementNotMet(claim.platformId);

        uint256 fee = Math.mulDiv(claim.faceValue, platform.advanceFeeBps, BPS_DENOMINATOR);
        uint256 advanceAmount = claim.faceValue - fee;
        if (advanceAmount == 0) revert ZeroAmount();
        if (advanceAmount > accountedCash) {
            revert InsufficientAccountedCash(advanceAmount, accountedCash);
        }
        uint256 actual = actualCash();
        if (advanceAmount > actual) revert InsufficientActualCash(advanceAmount, actual);

        _purchases[claimId] = Purchase({
            claimId: claimId,
            platformId: claim.platformId,
            worker: claim.worker,
            faceValue: claim.faceValue,
            advanceAmount: advanceAmount,
            fee: fee,
            dueDate: claim.dueDate,
            purchasedAt: uint64(block.timestamp),
            platformSettlementAmount: 0,
            reserveRecoveryAmount: 0,
            realizedProfit: 0,
            realizedLoss: 0,
            contractualShortfall: 0,
            status: PurchaseStatus.Outstanding
        });

        accountedCash -= advanceAmount;
        totalAdvancePrincipal += advanceAmount;
        outstandingPrincipal += advanceAmount;
        outstandingFaceValue += claim.faceValue;

        registry.increaseExposure(claim.platformId, claim.faceValue);
        earnings.markAdvanced(claimId);

        usdc.safeTransfer(claim.worker, advanceAmount);

        emit AdvancePurchased(claimId, claim.platformId, claim.worker, claim.faceValue, advanceAmount, fee);
    }

    // --- Settlement ---

    /// @notice Settles a purchased claim using an authorized platform payer.
    /// @dev Paused platforms remain authorized to repay existing claims.
    function settleClaim(uint256 claimId) external nonReentrant {
        Purchase storage purchase = _requireOutstandingPurchase(claimId);

        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        if (claim.status != EarningsManager.ClaimStatus.Advanced) {
            revert ClaimNotAdvanced(claimId, claim.status);
        }
        if (!registry.isAuthorizedSettlementPayer(purchase.platformId, msg.sender)) {
            revert UnauthorizedSettlementPayer(purchase.platformId, msg.sender);
        }

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), purchase.faceValue);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != purchase.faceValue) {
            revert SettlementNotReceived(claimId, purchase.faceValue, received);
        }

        uint256 profit = purchase.faceValue - purchase.advanceAmount;
        purchase.platformSettlementAmount = purchase.faceValue;
        purchase.realizedProfit = profit;
        purchase.status = PurchaseStatus.Settled;

        outstandingFaceValue -= purchase.faceValue;
        outstandingPrincipal -= purchase.advanceAmount;
        accountedCash += purchase.faceValue;
        totalSettledFaceValue += purchase.faceValue;
        totalRealizedProfit += profit;

        registry.decreaseExposure(purchase.platformId, purchase.faceValue);
        earnings.markSettled(claimId);

        emit ClaimSettledEvent(claimId, purchase.platformId, purchase.faceValue, purchase.fee);
    }

    // --- Default ---

    /// @notice Triggers a default on a purchased claim past its due date.
    /// @dev Draws from the platform's reserve. Pauses the platform. Permissionless after due date.
    function triggerDefault(uint256 claimId) external nonReentrant {
        Purchase storage purchase = _requireOutstandingPurchase(claimId);
        if (uint64(block.timestamp) <= purchase.dueDate) {
            revert ClaimNotPastDue(claimId, purchase.dueDate, uint64(block.timestamp));
        }

        uint256 balanceBefore = usdc.balanceOf(address(this));
        uint256 drawn = registry.drawReserve(purchase.platformId, purchase.faceValue);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != drawn) revert DefaultRecoveryMismatch(claimId, drawn, received);

        uint256 contractualShortfall = purchase.faceValue - drawn;
        uint256 profit;
        uint256 loss;
        if (drawn >= purchase.advanceAmount) {
            profit = drawn - purchase.advanceAmount;
        } else {
            loss = purchase.advanceAmount - drawn;
        }

        purchase.reserveRecoveryAmount = drawn;
        purchase.realizedProfit = profit;
        purchase.realizedLoss = loss;
        purchase.contractualShortfall = contractualShortfall;
        purchase.status = PurchaseStatus.Defaulted;

        outstandingFaceValue -= purchase.faceValue;
        outstandingPrincipal -= purchase.advanceAmount;
        accountedCash += drawn;
        totalDefaultRecoveries += drawn;
        totalRealizedProfit += profit;
        totalRealizedLoss += loss;
        totalContractualShortfall += contractualShortfall;

        registry.decreaseExposure(purchase.platformId, purchase.faceValue);
        registry.autoPause(purchase.platformId);
        earnings.markDefaulted(claimId);

        emit DefaultTriggered(claimId, purchase.platformId, drawn, profit, loss, contractualShortfall);
    }

    // --- Views ---

    function getPurchase(uint256 claimId) external view returns (Purchase memory) {
        return _purchases[claimId];
    }

    function actualCash() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function cashSurplus() public view returns (uint256) {
        uint256 actual = actualCash();
        return actual > accountedCash ? actual - accountedCash : 0;
    }

    function cashDeficit() public view returns (uint256) {
        uint256 actual = actualCash();
        return accountedCash > actual ? accountedCash - actual : 0;
    }

    function isCashReconciled() public view returns (bool) {
        return actualCash() == accountedCash;
    }

    /// @notice Net owner capital contributed; negative after withdrawals exceed deposits.
    function netLiquidityContributed() public view returns (int256) {
        return int256(totalLiquidityDeposited) - int256(totalLiquidityWithdrawn);
    }

    function accountedAssets() public view returns (uint256) {
        return accountedCash + outstandingPrincipal;
    }

    function vaultStats() external view returns (VaultStats memory) {
        return VaultStats({
            accountedCash: accountedCash,
            actualCash: actualCash(),
            accountedAssets: accountedAssets(),
            totalAdvancePrincipal: totalAdvancePrincipal,
            outstandingPrincipal: outstandingPrincipal,
            outstandingFaceValue: outstandingFaceValue,
            totalSettledFaceValue: totalSettledFaceValue,
            totalDefaultRecoveries: totalDefaultRecoveries,
            totalRealizedProfit: totalRealizedProfit,
            totalRealizedLoss: totalRealizedLoss,
            totalContractualShortfall: totalContractualShortfall,
            totalLiquidityDeposited: totalLiquidityDeposited,
            totalLiquidityWithdrawn: totalLiquidityWithdrawn,
            netLiquidityContributed: netLiquidityContributed()
        });
    }

    // --- Internal ---

    function _requireOutstandingPurchase(uint256 claimId) private view returns (Purchase storage purchase) {
        purchase = _purchases[claimId];
        if (purchase.status == PurchaseStatus.None) revert ClaimNotPurchased(claimId);
        if (purchase.status != PurchaseStatus.Outstanding) {
            revert ClaimAlreadyResolved(claimId, purchase.status);
        }
    }
}
