// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MandateManager} from "./MandateManager.sol";

/// @title AdvanceVault
/// @notice Operator-funded demo pool that advances USDC against locked Fidra receivables.
/// @dev This milestone intentionally omits LP shares, withdrawals, pricing curves, and idle-capital allocation.
contract AdvanceVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_DISCOUNT_BPS = 3_000;

    struct ClaimPurchase {
        uint256 requestId;
        address seller;
        uint256 faceAmount;
        uint256 advanceAmount;
        uint256 expectedSpread;
        uint64 purchasedAt;
        bool settled;
    }

    struct VaultStats {
        uint256 liquidityDeposited;
        uint256 advanced;
        uint256 faceValueAcquired;
        uint256 expectedSpread;
        uint256 repaymentsRecognized;
        uint256 realizedSpread;
        uint256 liquidityAvailable;
    }

    error ZeroAddress();
    error ZeroAmount();
    error InvalidDiscountBps(uint256 discountBps);
    error IncorrectLiquidityAmount(uint256 expected, uint256 received);
    error ClaimNotLocked(uint256 requestId, MandateManager.RequestStatus actual);
    error NotCurrentPayee(uint256 requestId, address expected, address caller);
    error ClaimAlreadyPurchased(uint256 requestId);
    error QuoteExpired(uint256 deadline, uint256 currentTimestamp);
    error AdvanceBelowMinimum(uint256 advanceAmount, uint256 minAdvanceAmount);
    error InsufficientLiquidity(uint256 required, uint256 available);
    error ClaimNotPurchased(uint256 requestId);
    error ClaimAlreadySettled(uint256 requestId);
    error ClaimNotReleased(uint256 requestId, MandateManager.RequestStatus actual);
    error RepaymentNotReceived(uint256 requestId, uint256 expectedBalance, uint256 actualBalance);

    event LiquidityDeposited(address indexed operator, uint256 amount);
    event ClaimPurchased(
        uint256 indexed requestId,
        address indexed seller,
        uint256 faceAmount,
        uint256 advanceAmount,
        uint256 expectedSpread
    );
    event ClaimSettled(uint256 indexed requestId, uint256 repayment, uint256 realizedSpread);

    IERC20 public immutable usdc;
    MandateManager public immutable mandateManager;
    uint256 public immutable discountBps;

    uint256 public totalLiquidityDeposited;
    uint256 public totalAdvanced;
    uint256 public totalFaceValueAcquired;
    uint256 public totalExpectedSpread;
    uint256 public totalRepaymentsRecognized;
    uint256 public totalRealizedSpread;

    uint256 private _accountedLiquidity;
    mapping(uint256 requestId => ClaimPurchase purchase) private _claimPurchases;

    constructor(address usdc_, address mandateManager_, uint256 discountBps_) Ownable(msg.sender) {
        if (usdc_ == address(0) || mandateManager_ == address(0)) revert ZeroAddress();
        if (discountBps_ == 0 || discountBps_ > MAX_DISCOUNT_BPS) {
            revert InvalidDiscountBps(discountBps_);
        }

        usdc = IERC20(usdc_);
        mandateManager = MandateManager(mandateManager_);
        discountBps = discountBps_;
    }

    /// @notice Adds operator-owned USDC liquidity available for claim advances.
    function depositLiquidity(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;
        if (received != amount) revert IncorrectLiquidityAmount(amount, received);

        totalLiquidityDeposited += amount;
        _accountedLiquidity += amount;
        emit LiquidityDeposited(msg.sender, amount);
    }

    /// @notice Purchases a locked claim from its current payee and atomically becomes the new payee.
    /// @param minAdvanceAmount Seller's minimum acceptable USDC proceeds under the fixed discount.
    /// @param deadline Last timestamp at which the seller permits this purchase to execute.
    function buyClaim(uint256 requestId, uint256 minAdvanceAmount, uint256 deadline) external nonReentrant {
        if (block.timestamp > deadline) revert QuoteExpired(deadline, block.timestamp);

        MandateManager.SpendRequest memory request = mandateManager.getSpendRequest(requestId);
        if (request.status != MandateManager.RequestStatus.Locked) {
            revert ClaimNotLocked(requestId, request.status);
        }
        if (request.payee != msg.sender) revert NotCurrentPayee(requestId, request.payee, msg.sender);
        if (_claimPurchases[requestId].seller != address(0)) revert ClaimAlreadyPurchased(requestId);

        uint256 faceAmount = request.amount;
        uint256 advanceAmount = Math.mulDiv(faceAmount, BPS_DENOMINATOR - discountBps, BPS_DENOMINATOR);
        if (advanceAmount == 0) revert ZeroAmount();
        if (advanceAmount < minAdvanceAmount) {
            revert AdvanceBelowMinimum(advanceAmount, minAdvanceAmount);
        }
        uint256 expectedSpread = faceAmount - advanceAmount;
        uint256 liquidity = availableLiquidity();
        if (advanceAmount > liquidity) revert InsufficientLiquidity(advanceAmount, liquidity);

        _claimPurchases[requestId] = ClaimPurchase({
            requestId: requestId,
            seller: msg.sender,
            faceAmount: faceAmount,
            advanceAmount: advanceAmount,
            expectedSpread: expectedSpread,
            purchasedAt: uint64(block.timestamp),
            settled: false
        });
        totalAdvanced += advanceAmount;
        totalFaceValueAcquired += faceAmount;
        totalExpectedSpread += expectedSpread;
        _accountedLiquidity -= advanceAmount;

        mandateManager.assignClaimForAdvance(requestId, msg.sender, address(this));
        usdc.safeTransfer(msg.sender, advanceAmount);

        emit ClaimPurchased(requestId, msg.sender, faceAmount, advanceAmount, expectedSpread);
    }

    /// @notice Recognizes a released claim repayment and its realized spread in demo pool accounting.
    /// @dev Anyone may call because both release state and received balance are objectively checked onchain.
    function markClaimSettled(uint256 requestId) external nonReentrant {
        ClaimPurchase storage purchase = _claimPurchases[requestId];
        if (purchase.seller == address(0)) revert ClaimNotPurchased(requestId);
        if (purchase.settled) revert ClaimAlreadySettled(requestId);

        MandateManager.SpendRequest memory request = mandateManager.getSpendRequest(requestId);
        if (request.status != MandateManager.RequestStatus.Released) {
            revert ClaimNotReleased(requestId, request.status);
        }

        uint256 expectedBalance = _accountedLiquidity + purchase.faceAmount;
        uint256 actualBalance = usdc.balanceOf(address(this));
        if (actualBalance < expectedBalance) {
            revert RepaymentNotReceived(requestId, expectedBalance, actualBalance);
        }

        purchase.settled = true;
        totalRepaymentsRecognized += purchase.faceAmount;
        totalRealizedSpread += purchase.expectedSpread;
        _accountedLiquidity = expectedBalance;

        emit ClaimSettled(requestId, purchase.faceAmount, purchase.expectedSpread);
    }

    function getClaimPurchase(uint256 requestId) external view returns (ClaimPurchase memory) {
        return _claimPurchases[requestId];
    }

    function poolStats() external view returns (VaultStats memory) {
        return VaultStats({
            liquidityDeposited: totalLiquidityDeposited,
            advanced: totalAdvanced,
            faceValueAcquired: totalFaceValueAcquired,
            expectedSpread: totalExpectedSpread,
            repaymentsRecognized: totalRepaymentsRecognized,
            realizedSpread: totalRealizedSpread,
            liquidityAvailable: availableLiquidity()
        });
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 balance = usdc.balanceOf(address(this));
        return balance < _accountedLiquidity ? balance : _accountedLiquidity;
    }
}
