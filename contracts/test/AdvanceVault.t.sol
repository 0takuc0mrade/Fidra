// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AdvanceVault} from "../src/AdvanceVault.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract AdvanceVaultTest is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant BUDGET = 1_000 * USDC;
    uint256 internal constant MAX_PURCHASE = 500 * USDC;
    uint256 internal constant FACE_AMOUNT = 100 * USDC;
    uint256 internal constant DISCOUNT_BPS = 100;
    uint256 internal constant ADVANCE_AMOUNT = 99 * USDC;
    uint256 internal constant EXPECTED_SPREAD = 1 * USDC;
    uint64 internal constant RELEASE_DELAY = 3 days;

    MockUSDC internal usdc;
    MandateManager internal manager;
    AdvanceVault internal vault;

    address internal business = makeAddr("business");
    address internal agent = makeAddr("agent");
    address internal approver = makeAddr("approver");
    address internal vendor = makeAddr("vendor");
    address internal stranger = makeAddr("stranger");
    address internal operator = makeAddr("operator");

    function setUp() public {
        usdc = new MockUSDC();
        manager = new MandateManager(usdc);

        vm.prank(operator);
        vault = new AdvanceVault(address(usdc), address(manager), DISCOUNT_BPS);
        manager.setAuthorizedAdvanceVault(address(vault));
        manager.freezeAuthorizedAdvanceVault();

        usdc.mint(business, 10_000 * USDC);
        usdc.mint(operator, 10_000 * USDC);

        vm.prank(business);
        usdc.approve(address(manager), type(uint256).max);
        vm.prank(operator);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_DepositLiquidityTransfersUSDCIntoVault() public {
        _depositLiquidity(500 * USDC);

        assertEq(usdc.balanceOf(address(vault)), 500 * USDC);
        assertEq(vault.totalLiquidityDeposited(), 500 * USDC);
        assertEq(vault.availableLiquidity(), 500 * USDC);
    }

    function test_DepositLiquidityIsOperatorOnly() public {
        vm.expectRevert();
        vm.prank(stranger);
        vault.depositLiquidity(100 * USDC);
    }

    function test_FrozenAuthorizedVaultCanStillBuyLockedClaim() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);

        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);

        assertTrue(manager.authorizedVaultFrozen());
        assertEq(manager.getSpendRequest(spendId).payee, address(vault));
        assertEq(usdc.balanceOf(vendor), ADVANCE_AMOUNT);
    }

    function test_BuyClaimRevertsForNonLockedClaim() public {
        (, uint256 spendId) = _createAndApprove(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);

        vm.expectRevert(
            abi.encodeWithSelector(AdvanceVault.ClaimNotLocked.selector, spendId, MandateManager.RequestStatus.Approved)
        );
        vm.prank(vendor);
        vault.buyClaim(spendId, 0, block.timestamp + 1 hours);
    }

    function test_BuyClaimRevertsIfCallerIsNotCurrentPayee() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVault.NotCurrentPayee.selector, spendId, vendor, stranger));
        vm.prank(stranger);
        vault.buyClaim(spendId, 0, block.timestamp + 1 hours);
    }

    function test_BuyClaimRevertsIfClaimAlreadyPurchased() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVault.ClaimAlreadyPurchased.selector, spendId));
        vm.prank(address(vault));
        vault.buyClaim(spendId, 0, block.timestamp + 1 hours);
    }

    function test_BuyClaimRevertsIfVaultHasInsufficientLiquidity() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVault.InsufficientLiquidity.selector, ADVANCE_AMOUNT, 0));
        vm.prank(vendor);
        vault.buyClaim(spendId, 0, block.timestamp + 1 hours);
    }

    function test_BuyClaimRevertsAfterDeadline() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        uint256 deadline = block.timestamp + 1 hours;
        vm.warp(deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVault.QuoteExpired.selector, deadline, block.timestamp));
        vm.prank(vendor);
        vault.buyClaim(spendId, 0, deadline);
    }

    function test_BuyClaimSucceedsAtExactDeadline() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        uint256 deadline = block.timestamp + 1 hours;
        vm.warp(deadline);

        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, deadline);

        assertEq(manager.getSpendRequest(spendId).payee, address(vault));
        assertEq(usdc.balanceOf(vendor), ADVANCE_AMOUNT);
    }

    function test_BuyClaimRevertsIfAdvanceIsBelowMinimum() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);

        vm.expectRevert(
            abi.encodeWithSelector(AdvanceVault.AdvanceBelowMinimum.selector, ADVANCE_AMOUNT, ADVANCE_AMOUNT + 1)
        );
        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT + 1, block.timestamp + 1 hours);
    }

    function test_QuoteProtectionFailureLeavesAssignmentPaymentAndAccountingUnchanged() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        uint256 sellerBalanceBefore = usdc.balanceOf(vendor);
        uint256 vaultBalanceBefore = usdc.balanceOf(address(vault));

        vm.expectRevert(
            abi.encodeWithSelector(AdvanceVault.AdvanceBelowMinimum.selector, ADVANCE_AMOUNT, ADVANCE_AMOUNT + 1)
        );
        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT + 1, block.timestamp + 1 hours);

        AdvanceVault.ClaimPurchase memory purchase = vault.getClaimPurchase(spendId);
        AdvanceVault.VaultStats memory stats = vault.poolStats();
        assertEq(manager.getSpendRequest(spendId).payee, vendor);
        assertEq(usdc.balanceOf(vendor), sellerBalanceBefore);
        assertEq(usdc.balanceOf(address(vault)), vaultBalanceBefore);
        assertEq(purchase.seller, address(0));
        assertEq(stats.advanced, 0);
        assertEq(stats.faceValueAcquired, 0);
    }

    function test_BuyClaimSucceedsWhenMinimumSatisfiedAndAtomicallyAssigns() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);

        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);

        MandateManager.SpendRequest memory request = manager.getSpendRequest(spendId);
        AdvanceVault.ClaimPurchase memory purchase = vault.getClaimPurchase(spendId);
        AdvanceVault.VaultStats memory stats = vault.poolStats();

        assertEq(request.vendor, vendor);
        assertEq(request.payee, address(vault));
        assertEq(usdc.balanceOf(vendor), ADVANCE_AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), 401 * USDC);
        assertEq(purchase.requestId, spendId);
        assertEq(purchase.seller, vendor);
        assertEq(purchase.faceAmount, FACE_AMOUNT);
        assertEq(purchase.advanceAmount, ADVANCE_AMOUNT);
        assertEq(purchase.expectedSpread, EXPECTED_SPREAD);
        assertGt(purchase.purchasedAt, 0);
        assertFalse(purchase.settled);
        assertEq(stats.advanced, ADVANCE_AMOUNT);
        assertEq(stats.faceValueAcquired, FACE_AMOUNT);
        assertEq(stats.expectedSpread, EXPECTED_SPREAD);
        assertEq(stats.liquidityAvailable, 401 * USDC);
    }

    function test_ReleaseSpendPaysAdvanceVaultAfterAssignment() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);

        vm.prank(approver);
        manager.releaseSpend(spendId);

        assertEq(usdc.balanceOf(vendor), ADVANCE_AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), 501 * USDC);
        assertEq(uint256(manager.getSpendRequest(spendId).status), uint256(MandateManager.RequestStatus.Released));
    }

    function test_PoolEarnsExpectedSpreadAfterReleaseAndSettlementAccounting() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);
        vm.prank(approver);
        manager.releaseSpend(spendId);

        vault.markClaimSettled(spendId);

        AdvanceVault.ClaimPurchase memory purchase = vault.getClaimPurchase(spendId);
        AdvanceVault.VaultStats memory stats = vault.poolStats();
        assertTrue(purchase.settled);
        assertEq(stats.repaymentsRecognized, FACE_AMOUNT);
        assertEq(stats.realizedSpread, EXPECTED_SPREAD);
        assertEq(stats.liquidityAvailable, 501 * USDC);
    }

    function test_AnyoneCanReleasePurchasedClaimAfterReleaseDueAt() public {
        (, uint256 spendId) = _createAndLock(FACE_AMOUNT, false);
        _depositLiquidity(500 * USDC);
        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);

        MandateManager.SpendRequest memory request = manager.getSpendRequest(spendId);
        vm.warp(request.releaseDueAt);
        vm.prank(stranger);
        manager.releaseSpend(spendId);

        assertEq(usdc.balanceOf(vendor), ADVANCE_AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), 501 * USDC);
        assertEq(uint256(manager.getSpendRequest(spendId).status), uint256(MandateManager.RequestStatus.Released));
    }

    function testFullFlow_FrozenVaultClaimStillReleasesAfterMandateRevoked() public {
        (uint256 mandateId, uint256 spendId) = _createAndApprove(FACE_AMOUNT, true);

        vm.prank(approver);
        manager.lockSpend(spendId);
        _depositLiquidity(500 * USDC);

        vm.prank(vendor);
        vault.buyClaim(spendId, ADVANCE_AMOUNT, block.timestamp + 1 hours);
        assertEq(usdc.balanceOf(vendor), ADVANCE_AMOUNT);
        assertEq(manager.getSpendRequest(spendId).payee, address(vault));

        vm.prank(business);
        manager.revokeMandate(mandateId);
        MandateManager.SpendRequest memory request = manager.getSpendRequest(spendId);
        vm.warp(request.releaseDueAt);
        vm.prank(stranger);
        manager.releaseSpend(spendId);
        vault.markClaimSettled(spendId);

        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        AdvanceVault.VaultStats memory stats = vault.poolStats();
        assertEq(usdc.balanceOf(address(vault)), 501 * USDC);
        assertEq(mandate.reserved, 0);
        assertEq(mandate.spent, FACE_AMOUNT);
        assertEq(stats.repaymentsRecognized, FACE_AMOUNT);
        assertEq(stats.realizedSpread, EXPECTED_SPREAD);
        assertEq(stats.liquidityAvailable, 501 * USDC);
    }

    function testFuzz_PurchasedClaimSpreadEqualsFaceMinusAdvance(uint96 rawAmount) public {
        uint256 faceAmount = bound(uint256(rawAmount), 100, MAX_PURCHASE);
        (, uint256 spendId) = _createAndLock(faceAmount, false);
        _depositLiquidity(MAX_PURCHASE);

        vm.prank(vendor);
        vault.buyClaim(spendId, 0, block.timestamp + 1 hours);

        AdvanceVault.ClaimPurchase memory purchase = vault.getClaimPurchase(spendId);
        assertEq(purchase.expectedSpread, purchase.faceAmount - purchase.advanceAmount);
        assertEq(vault.totalExpectedSpread(), purchase.expectedSpread);
    }

    function _depositLiquidity(uint256 amount) internal {
        vm.prank(operator);
        vault.depositLiquidity(amount);
    }

    function _createAndApprove(uint256 amount, bool proofRequired)
        internal
        returns (uint256 mandateId, uint256 spendId)
    {
        address[] memory allowedVendors = new address[](1);
        allowedVendors[0] = vendor;

        vm.prank(business);
        mandateId = manager.createMandate(
            agent,
            approver,
            BUDGET,
            uint64(block.timestamp + 7 days),
            RELEASE_DELAY,
            MAX_PURCHASE,
            proofRequired,
            keccak256("mandate-metadata"),
            allowedVendors
        );

        vm.prank(agent);
        spendId = manager.requestSpend(mandateId, vendor, amount, keccak256(abi.encode("vault-ref", mandateId)));

        if (proofRequired) {
            vm.prank(vendor);
            manager.submitProof(spendId, keccak256("receipt"));
        }
        vm.prank(approver);
        manager.approveSpend(spendId);
    }

    function _createAndLock(uint256 amount, bool proofRequired) internal returns (uint256 mandateId, uint256 spendId) {
        (mandateId, spendId) = _createAndApprove(amount, proofRequired);
        vm.prank(approver);
        manager.lockSpend(spendId);
    }
}
