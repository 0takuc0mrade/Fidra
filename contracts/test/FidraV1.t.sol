// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PlatformRegistry} from "../src/PlatformRegistry.sol";
import {EarningsManager} from "../src/EarningsManager.sol";
import {AdvanceVaultV2} from "../src/AdvanceVaultV2.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract FidraV1Test is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant CREDIT_LIMIT = 10_000 * USDC;
    uint256 internal constant FEE_BPS = 100; // 1%
    uint256 internal constant FACE_VALUE = 100 * USDC;
    uint64 internal constant DUE_DATE_OFFSET = 7 days;
    uint256 internal constant VAULT_LIQUIDITY = 50_000 * USDC;
    uint256 internal constant RESERVE_AMOUNT = 5_000 * USDC;

    MockUSDC internal usdc;
    PlatformRegistry internal registry;
    EarningsManager internal earnings;
    AdvanceVaultV2 internal vault;

    address internal owner;
    address internal platformWallet = makeAddr("platformWallet");
    address internal worker = makeAddr("worker");
    address internal stranger = makeAddr("stranger");

    uint256 internal platformId;

    function setUp() public {
        owner = address(this);

        usdc = new MockUSDC();
        registry = new PlatformRegistry(usdc);
        earnings = new EarningsManager(registry);
        vault = new AdvanceVaultV2(address(usdc), address(registry), address(earnings));

        // Wire up vault authorization
        registry.setAuthorizedVault(address(vault));
        earnings.setAuthorizedVault(address(vault));

        // Register a platform
        platformId = registry.registerPlatform(platformWallet, CREDIT_LIMIT, FEE_BPS);

        // Deposit reserve
        usdc.mint(owner, RESERVE_AMOUNT);
        usdc.approve(address(registry), RESERVE_AMOUNT);
        registry.depositReserve(platformId, RESERVE_AMOUNT);

        // Fund vault liquidity
        usdc.mint(owner, VAULT_LIQUIDITY);
        usdc.approve(address(vault), VAULT_LIQUIDITY);
        vault.depositLiquidity(VAULT_LIQUIDITY);

        // Give platform wallet USDC for settlements
        usdc.mint(platformWallet, 100_000 * USDC);
        vm.prank(platformWallet);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ================================================================
    //  Helpers
    // ================================================================

    function _dueDate() internal view returns (uint64) {
        return uint64(block.timestamp) + DUE_DATE_OFFSET;
    }

    function _createClaim(address w, uint256 faceValue, bytes32 taskHash) internal returns (uint256 claimId) {
        vm.prank(platformWallet);
        claimId = earnings.createClaim(platformId, w, faceValue, _dueDate(), taskHash, keccak256("evidence"));
    }

    function _createAndCertify(address w, uint256 faceValue, bytes32 taskHash) internal returns (uint256 claimId) {
        claimId = _createClaim(w, faceValue, taskHash);
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);
    }

    function _createCertifyAndAdvance(address w, uint256 faceValue, bytes32 taskHash)
        internal
        returns (uint256 claimId)
    {
        claimId = _createAndCertify(w, faceValue, taskHash);
        vm.prank(w);
        vault.purchaseAdvance(claimId);
    }

    function _expectedAdvance(uint256 faceValue) internal pure returns (uint256) {
        uint256 fee = (faceValue * FEE_BPS) / 10_000;
        return faceValue - fee;
    }

    function _expectedFee(uint256 faceValue) internal pure returns (uint256) {
        return (faceValue * FEE_BPS) / 10_000;
    }

    function _batchInputs(uint256 length)
        internal
        view
        returns (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        )
    {
        workers = new address[](length);
        faceValues = new uint256[](length);
        dueDates = new uint64[](length);
        taskHashes = new bytes32[](length);
        evidenceHashes = new bytes32[](length);

        for (uint256 i; i < length; ++i) {
            workers[i] = address(uint160(10_000 + i));
            faceValues[i] = (i + 1) * USDC;
            dueDates[i] = _dueDate();
            taskHashes[i] = keccak256(abi.encode("batch-task", i, length));
            evidenceHashes[i] = keccak256(abi.encode("batch-evidence", i, length));
        }
    }

    // ================================================================
    //  PlatformRegistry tests
    // ================================================================

    function test_RegisterPlatformStoresCorrectFields() public view {
        PlatformRegistry.Platform memory p = registry.getPlatform(platformId);
        assertEq(p.settlementWallet, platformWallet);
        assertTrue(p.active);
        assertEq(p.creditLimit, CREDIT_LIMIT);
        assertEq(p.outstandingExposure, 0);
        assertEq(p.reserveBalance, RESERVE_AMOUNT);
        assertEq(p.advanceFeeBps, FEE_BPS);
    }

    function test_RegisterPlatformRejectsZeroWallet() public {
        vm.expectRevert(PlatformRegistry.ZeroAddress.selector);
        registry.registerPlatform(address(0), CREDIT_LIMIT, FEE_BPS);
    }

    function test_RegisterPlatformRejectsExcessiveFee() public {
        vm.expectRevert(abi.encodeWithSelector(PlatformRegistry.InvalidFeeBps.selector, 3001));
        registry.registerPlatform(platformWallet, CREDIT_LIMIT, 3001);
    }

    function test_PausePlatformPreventsNewCertification() public {
        uint256 claimId = _createClaim(worker, FACE_VALUE, keccak256("task-pause"));
        registry.pausePlatform(platformId);

        vm.expectRevert(abi.encodeWithSelector(EarningsManager.PlatformNotActive.selector, platformId));
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);
    }

    function test_UnpausePlatformRestoresAccess() public {
        registry.pausePlatform(platformId);
        registry.unpausePlatform(platformId);

        uint256 claimId = _createClaim(worker, FACE_VALUE, keccak256("task-unpause"));
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);

        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Certified));
    }

    function test_VaultCanOnlyBeSetOnce() public {
        vm.expectRevert(PlatformRegistry.VaultAlreadySet.selector);
        registry.setAuthorizedVault(makeAddr("newVault"));
    }

    // ================================================================
    //  EarningsManager tests
    // ================================================================

    function test_CreateClaimStoresFields() public {
        bytes32 taskHash = keccak256("task-1");
        uint256 claimId = _createClaim(worker, FACE_VALUE, taskHash);

        EarningsManager.Claim memory c = earnings.getClaim(claimId);
        assertEq(c.platformId, platformId);
        assertEq(c.worker, worker);
        assertEq(c.faceValue, FACE_VALUE);
        assertEq(c.taskHash, taskHash);
        assertEq(uint256(c.status), uint256(EarningsManager.ClaimStatus.Pending));
    }

    function test_DuplicateTaskHashRejected() public {
        bytes32 taskHash = keccak256("dup-task");
        _createClaim(worker, FACE_VALUE, taskHash);

        vm.expectRevert(abi.encodeWithSelector(EarningsManager.TaskHashAlreadyUsed.selector, platformId, taskHash));
        vm.prank(platformWallet);
        earnings.createClaim(platformId, worker, FACE_VALUE, _dueDate(), taskHash, keccak256("ev2"));
    }

    function test_StrangerCannotCreateClaim() public {
        vm.expectRevert(abi.encodeWithSelector(EarningsManager.NotPlatformWallet.selector, platformId, stranger));
        vm.prank(stranger);
        earnings.createClaim(platformId, worker, FACE_VALUE, _dueDate(), keccak256("task-x"), keccak256("ev-x"));
    }

    function test_CertifyClaimMakesItImmutable() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-cert"));

        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Certified));
    }

    // ================================================================
    //  Pre-certification cancellation
    // ================================================================

    function test_CancelPendingClaimSucceeds() public {
        uint256 claimId = _createClaim(worker, FACE_VALUE, keccak256("task-cancel"));

        vm.prank(platformWallet);
        earnings.cancelClaim(claimId);

        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Cancelled));
    }

    function test_CannotCancelCertifiedClaim() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-no-cancel"));

        vm.expectRevert(
            abi.encodeWithSelector(
                EarningsManager.InvalidClaimStatus.selector, claimId, EarningsManager.ClaimStatus.Certified
            )
        );
        vm.prank(platformWallet);
        earnings.cancelClaim(claimId);
    }

    // ================================================================
    //  Successful payout flow
    // ================================================================

    function test_SuccessfulPayoutFlow() public {
        // 1. Create and certify
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-payout"));

        // 2. Worker takes advance
        uint256 workerBalBefore = usdc.balanceOf(worker);
        vm.prank(worker);
        vault.purchaseAdvance(claimId);

        uint256 expectedAdv = _expectedAdvance(FACE_VALUE);
        assertEq(usdc.balanceOf(worker) - workerBalBefore, expectedAdv);
        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Advanced));

        // Exposure increased
        PlatformRegistry.Platform memory p = registry.getPlatform(platformId);
        assertEq(p.outstandingExposure, FACE_VALUE);

        // Vault accounting
        assertEq(vault.outstandingFaceValue(), FACE_VALUE);
        assertEq(vault.outstandingPrincipal(), expectedAdv);

        // 3. Platform settles
        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Settled));
        assertEq(vault.outstandingFaceValue(), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.totalSettledFaceValue(), FACE_VALUE);
        assertEq(vault.totalRealizedProfit(), _expectedFee(FACE_VALUE));

        // Exposure decreased
        PlatformRegistry.Platform memory p2 = registry.getPlatform(platformId);
        assertEq(p2.outstandingExposure, 0);
    }

    // ================================================================
    //  Duplicate purchase prevention
    // ================================================================

    function test_DuplicatePurchaseReverts() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-dup"));

        vm.prank(worker);
        vault.purchaseAdvance(claimId);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.ClaimAlreadyPurchased.selector, claimId));
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  Credit limit breach
    // ================================================================

    function test_CreditLimitBreachReverts() public {
        // Create claims up to credit limit
        uint256 perClaim = CREDIT_LIMIT / 2;
        uint256 c1 = _createCertifyAndAdvance(worker, perClaim, keccak256("cl-1"));
        _createCertifyAndAdvance(worker, perClaim, keccak256("cl-2"));

        // One more should breach
        uint256 c3 = _createAndCertify(worker, 1 * USDC, keccak256("cl-3"));

        vm.expectRevert(
            abi.encodeWithSelector(
                PlatformRegistry.CreditLimitExceeded.selector, platformId, CREDIT_LIMIT + 1 * USDC, CREDIT_LIMIT
            )
        );
        vm.prank(worker);
        vault.purchaseAdvance(c3);

        // Settle one to free up credit
        vm.prank(platformWallet);
        vault.settleClaim(c1);

        // Now the third advance should succeed
        vm.prank(worker);
        vault.purchaseAdvance(c3);

        // Cleanup: c2 still advanced
        assertEq(registry.getPlatform(platformId).outstandingExposure, perClaim + 1 * USDC);
    }

    // ================================================================
    //  No advance before certification
    // ================================================================

    function test_AdvanceBeforeCertificationReverts() public {
        uint256 claimId = _createClaim(worker, FACE_VALUE, keccak256("task-no-cert"));

        vm.expectRevert(
            abi.encodeWithSelector(
                AdvanceVaultV2.ClaimNotCertified.selector, claimId, EarningsManager.ClaimStatus.Pending
            )
        );
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  Forbidden post-certification revocation
    // ================================================================

    function test_PostCertificationCancelReverts() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-post-cert-cancel"));

        vm.expectRevert(
            abi.encodeWithSelector(
                EarningsManager.InvalidClaimStatus.selector, claimId, EarningsManager.ClaimStatus.Certified
            )
        );
        vm.prank(platformWallet);
        earnings.cancelClaim(claimId);
    }

    function test_PostAdvanceCancelReverts() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-post-adv-cancel"));

        vm.expectRevert(
            abi.encodeWithSelector(
                EarningsManager.InvalidClaimStatus.selector, claimId, EarningsManager.ClaimStatus.Advanced
            )
        );
        vm.prank(platformWallet);
        earnings.cancelClaim(claimId);
    }

    // ================================================================
    //  Successful platform settlement
    // ================================================================

    function test_PlatformSettlementReducesExposureAndCreditsVault() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-settle"));

        uint256 vaultBalBefore = usdc.balanceOf(address(vault));
        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        assertEq(usdc.balanceOf(address(vault)) - vaultBalBefore, FACE_VALUE);
        assertEq(vault.outstandingFaceValue(), 0);
        assertEq(vault.totalSettledFaceValue(), FACE_VALUE);
        assertEq(registry.getPlatform(platformId).outstandingExposure, 0);
    }

    function test_DoubleSettlementReverts() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-double-settle"));

        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        vm.expectRevert(
            abi.encodeWithSelector(
                AdvanceVaultV2.ClaimAlreadyResolved.selector, claimId, AdvanceVaultV2.PurchaseStatus.Settled
            )
        );
        vm.prank(platformWallet);
        vault.settleClaim(claimId);
    }

    // ================================================================
    //  Reserve-backed default
    // ================================================================

    function test_ReserveBackedDefault() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-default"));

        // Warp past due date
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        vm.warp(uint256(claim.dueDate) + 1);

        uint256 reserveBefore = registry.getPlatform(platformId).reserveBalance;

        // Anyone can trigger default
        vm.prank(stranger);
        vault.triggerDefault(claimId);

        // Default is a distinct terminal state.
        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Defaulted));

        // Reserve was drawn
        PlatformRegistry.Platform memory p = registry.getPlatform(platformId);
        assertEq(reserveBefore - p.reserveBalance, FACE_VALUE);

        // Platform is paused
        assertFalse(p.active);

        // Exposure cleared
        assertEq(p.outstandingExposure, 0);

        // Vault accounting updated
        assertEq(vault.outstandingFaceValue(), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.totalDefaultRecoveries(), FACE_VALUE);
        assertEq(vault.totalSettledFaceValue(), 0);
    }

    // ================================================================
    //  Automatic platform pause on default
    // ================================================================

    function test_DefaultPausesPlatformAndPreventsNewAdvances() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-pause-default"));
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        vm.warp(uint256(claim.dueDate) + 1);

        vm.prank(stranger);
        vault.triggerDefault(claimId);

        // Platform is paused
        assertFalse(registry.isPlatformActive(platformId));

        // Cannot create new claims on paused platform
        vm.expectRevert(abi.encodeWithSelector(EarningsManager.PlatformNotActive.selector, platformId));
        vm.prank(platformWallet);
        earnings.createClaim(platformId, worker, FACE_VALUE, _dueDate(), keccak256("task-blocked"), keccak256("ev"));
    }

    // ================================================================
    //  Default before due date is rejected
    // ================================================================

    function test_DefaultBeforeDueDateReverts() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-early-default"));

        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        vm.expectRevert(
            abi.encodeWithSelector(
                AdvanceVaultV2.ClaimNotPastDue.selector, claimId, claim.dueDate, uint64(block.timestamp)
            )
        );
        vm.prank(stranger);
        vault.triggerDefault(claimId);
    }

    // ================================================================
    //  Partial reserve coverage (reserve < face value)
    // ================================================================

    function test_PartialReserveDefaultRecordsShortfall() public {
        // Create a large claim that exceeds reserve
        uint256 largeFace = RESERVE_AMOUNT * 2;
        // Need to expand credit limit for this test
        registry.updatePlatform(platformId, platformWallet, largeFace + CREDIT_LIMIT, FEE_BPS);

        uint256 claimId = _createCertifyAndAdvance(worker, largeFace, keccak256("task-partial"));
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        vm.warp(uint256(claim.dueDate) + 1);

        uint256 vaultBalBefore = usdc.balanceOf(address(vault));
        vm.prank(stranger);
        vault.triggerDefault(claimId);

        // Reserve fully drained
        assertEq(registry.getPlatform(platformId).reserveBalance, 0);

        // Vault received only reserve amount
        assertEq(usdc.balanceOf(address(vault)) - vaultBalBefore, RESERVE_AMOUNT);

        // Platform paused
        assertFalse(registry.isPlatformActive(platformId));
    }

    // ================================================================
    //  Worker's completed payout is not affected by default
    // ================================================================

    function test_DefaultDoesNotReduceWorkerPayout() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-worker-safe"));
        uint256 workerBalance = usdc.balanceOf(worker);

        // Worker already has their advance
        assertEq(workerBalance, _expectedAdvance(FACE_VALUE));

        // Default happens
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        vm.warp(uint256(claim.dueDate) + 1);
        vm.prank(stranger);
        vault.triggerDefault(claimId);

        // Worker's balance is unchanged — default only affects vault/platform
        assertEq(usdc.balanceOf(worker), workerBalance);
    }

    // ================================================================
    //  Only the claim's worker can purchase
    // ================================================================

    function test_StrangerCannotPurchaseWorkersAdvance() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-stranger"));

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.NotClaimWorker.selector, claimId, worker, stranger));
        vm.prank(stranger);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  Inactive platform prevents advance
    // ================================================================

    function test_AdvanceOnPausedPlatformReverts() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-paused-adv"));
        registry.pausePlatform(platformId);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.PlatformNotActive.selector, platformId));
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  Insufficient liquidity
    // ================================================================

    function test_InsufficientVaultLiquidityReverts() public {
        // Withdraw most liquidity
        vault.withdrawLiquidity(VAULT_LIQUIDITY - 1 * USDC);

        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-no-liq"));
        uint256 expectedAdv = _expectedAdvance(FACE_VALUE);

        vm.expectRevert(
            abi.encodeWithSelector(AdvanceVaultV2.InsufficientAccountedCash.selector, expectedAdv, 1 * USDC)
        );
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  Liquidity deposit and withdraw
    // ================================================================

    function test_DepositAndWithdrawLiquidity() public {
        uint256 additional = 1_000 * USDC;
        usdc.mint(owner, additional);
        usdc.approve(address(vault), additional);
        vault.depositLiquidity(additional);

        assertEq(vault.accountedCash(), VAULT_LIQUIDITY + additional);

        vault.withdrawLiquidity(additional);
        assertEq(vault.accountedCash(), VAULT_LIQUIDITY);
    }

    function test_WithdrawExceedsAvailableReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                AdvanceVaultV2.WithdrawExceedsAvailable.selector, VAULT_LIQUIDITY + 1, VAULT_LIQUIDITY
            )
        );
        vault.withdrawLiquidity(VAULT_LIQUIDITY + 1);
    }

    // ================================================================
    //  Cancelled claim cannot be advanced
    // ================================================================

    function test_CancelledClaimCannotBeAdvanced() public {
        uint256 claimId = _createClaim(worker, FACE_VALUE, keccak256("task-cancelled-adv"));
        vm.prank(platformWallet);
        earnings.cancelClaim(claimId);

        vm.expectRevert(
            abi.encodeWithSelector(
                AdvanceVaultV2.ClaimNotCertified.selector, claimId, EarningsManager.ClaimStatus.Cancelled
            )
        );
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  Fuzz: advance amount + fee = face value
    // ================================================================

    function testFuzz_AdvancePlusFeeEqualsFaceValue(uint96 rawFace) public {
        uint256 faceValue = bound(uint256(rawFace), 100, 1_000_000 * USDC);
        // Create a platform with enough credit
        uint256 largePlatformId = registry.registerPlatform(platformWallet, faceValue + 1, FEE_BPS);
        usdc.mint(owner, 1);
        usdc.approve(address(registry), 1);
        registry.depositReserve(largePlatformId, 1);

        vm.prank(platformWallet);
        uint256 claimId = earnings.createClaim(
            largePlatformId,
            worker,
            faceValue,
            _dueDate(),
            keccak256(abi.encode("fuzz-task", rawFace)),
            keccak256("fuzz-evidence")
        );
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);

        // Ensure enough vault liquidity
        uint256 needed = faceValue; // more than advance, safe upper bound
        uint256 currentLiq = vault.accountedCash();
        if (needed > currentLiq) {
            uint256 extra = needed - currentLiq;
            usdc.mint(owner, extra);
            usdc.approve(address(vault), extra);
            vault.depositLiquidity(extra);
        }

        vm.prank(worker);
        vault.purchaseAdvance(claimId);

        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        assertEq(purchase.advanceAmount + purchase.fee, purchase.faceValue);
    }

    // ================================================================
    //  Fuzz: settlement restores vault balance
    // ================================================================

    function testFuzz_SettlementRestoresVaultBalance(uint96 rawFace) public {
        uint256 faceValue = bound(uint256(rawFace), 100, 500 * USDC);

        uint256 claimId = _createCertifyAndAdvance(worker, faceValue, keccak256(abi.encode("fuzz-settle", rawFace)));

        uint256 vaultBalBefore = usdc.balanceOf(address(vault));
        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        assertEq(usdc.balanceOf(address(vault)) - vaultBalBefore, faceValue);
        assertEq(vault.outstandingFaceValue(), 0);
    }

    // ================================================================
    //  Multiple workers, multiple claims
    // ================================================================

    function test_MultipleWorkersIndependent() public {
        address worker2 = makeAddr("worker2");

        uint256 c1 = _createCertifyAndAdvance(worker, 50 * USDC, keccak256("multi-1"));
        uint256 c2 = _createCertifyAndAdvance(worker2, 75 * USDC, keccak256("multi-2"));

        assertEq(vault.outstandingFaceValue(), 125 * USDC);
        assertEq(registry.getPlatform(platformId).outstandingExposure, 125 * USDC);

        // Settle one
        vm.prank(platformWallet);
        vault.settleClaim(c1);

        assertEq(vault.outstandingFaceValue(), 75 * USDC);
        assertEq(registry.getPlatform(platformId).outstandingExposure, 75 * USDC);

        // Settle other
        vm.prank(platformWallet);
        vault.settleClaim(c2);

        assertEq(vault.outstandingFaceValue(), 0);
        assertEq(registry.getPlatform(platformId).outstandingExposure, 0);
    }

    // ================================================================
    //  Vault stats view
    // ================================================================

    function test_VaultStatsAccurate() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-stats"));

        AdvanceVaultV2.VaultStats memory s1 = vault.vaultStats();
        assertEq(s1.totalAdvancePrincipal, _expectedAdvance(FACE_VALUE));
        assertEq(s1.outstandingPrincipal, _expectedAdvance(FACE_VALUE));
        assertEq(s1.outstandingFaceValue, FACE_VALUE);
        assertEq(s1.totalSettledFaceValue, 0);
        assertEq(s1.totalRealizedProfit, 0);

        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        AdvanceVaultV2.VaultStats memory s2 = vault.vaultStats();
        assertEq(s2.outstandingFaceValue, 0);
        assertEq(s2.outstandingPrincipal, 0);
        assertEq(s2.totalSettledFaceValue, FACE_VALUE);
        assertEq(s2.totalRealizedProfit, _expectedFee(FACE_VALUE));
    }

    // ================================================================
    //  Claim due date validation
    // ================================================================

    function test_CreateClaimWithPastDueDateReverts() public {
        vm.expectRevert(abi.encodeWithSelector(EarningsManager.DueDateInPast.selector, uint64(block.timestamp)));
        vm.prank(platformWallet);
        earnings.createClaim(
            platformId, worker, FACE_VALUE, uint64(block.timestamp), keccak256("past-due"), keccak256("ev")
        );
    }

    // ================================================================
    //  Reserve withdrawal limits
    // ================================================================

    function test_ReserveWithdrawExceedsBalanceReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                PlatformRegistry.WithdrawExceedsReserve.selector, platformId, RESERVE_AMOUNT + 1, RESERVE_AMOUNT
            )
        );
        registry.withdrawReserve(platformId, RESERVE_AMOUNT + 1);
    }

    // ================================================================
    //  Credit limit cannot drop below exposure
    // ================================================================

    function test_UpdateCreditLimitBelowExposureReverts() public {
        _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("task-limit"));

        vm.expectRevert(
            abi.encodeWithSelector(
                PlatformRegistry.CreditLimitBelowExposure.selector, platformId, FACE_VALUE - 1, FACE_VALUE
            )
        );
        registry.updatePlatform(platformId, platformWallet, FACE_VALUE - 1, FEE_BPS);
    }

    // ================================================================
    //  Settle un-purchased claim reverts
    // ================================================================

    function test_SettleUnpurchasedClaimReverts() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-no-purchase"));

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.ClaimNotPurchased.selector, claimId));
        vm.prank(platformWallet);
        vault.settleClaim(claimId);
    }

    // ================================================================
    //  Default on un-purchased claim reverts
    // ================================================================

    function test_DefaultOnUnpurchasedClaimReverts() public {
        uint256 claimId = _createAndCertify(worker, FACE_VALUE, keccak256("task-unpurch-default"));
        vm.warp(block.timestamp + DUE_DATE_OFFSET + 1);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.ClaimNotPurchased.selector, claimId));
        vm.prank(stranger);
        vault.triggerDefault(claimId);
    }

    // ================================================================
    //  V1.1 deterministic accounting and authorization cases
    // ================================================================

    function test_V11_HundredFaceNinetyNineAdvanceSettlesForHundred() public {
        uint256 claimId = _createAndCertify(worker, 100 * USDC, keccak256("v11-exact-settlement"));
        uint256 initialAssets = vault.accountedAssets();

        vm.prank(worker);
        vault.purchaseAdvance(claimId);

        AdvanceVaultV2.Purchase memory outstanding = vault.getPurchase(claimId);
        assertEq(outstanding.advanceAmount, 99 * USDC);
        assertEq(vault.outstandingPrincipal(), 99 * USDC);
        assertEq(vault.outstandingFaceValue(), 100 * USDC);
        assertEq(vault.accountedAssets(), initialAssets);

        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        AdvanceVaultV2.Purchase memory settled = vault.getPurchase(claimId);
        assertEq(settled.platformSettlementAmount, 100 * USDC);
        assertEq(settled.realizedProfit, 1 * USDC);
        assertEq(uint256(settled.status), uint256(AdvanceVaultV2.PurchaseStatus.Settled));
        assertEq(vault.totalSettledFaceValue(), 100 * USDC);
        assertEq(vault.totalRealizedProfit(), 1 * USDC);
        assertEq(vault.totalRealizedLoss(), 0);
        assertEq(vault.accountedAssets(), initialAssets + 1 * USDC);
        assertEq(
            int256(vault.accountedAssets()),
            vault.netLiquidityContributed() + int256(vault.totalRealizedProfit()) - int256(vault.totalRealizedLoss())
        );
    }

    function test_V11_NetLiquidityContributedCanBeNegativeAfterProfitWithdrawal() public {
        uint256 claimId = _createAndCertify(worker, 100 * USDC, keccak256("v11-profit-withdrawal"));

        vm.prank(worker);
        vault.purchaseAdvance(claimId);
        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        vault.withdrawLiquidity(VAULT_LIQUIDITY + 1 * USDC);

        assertEq(vault.accountedAssets(), 0);
        assertEq(vault.netLiquidityContributed(), -int256(1 * USDC));
        assertEq(vault.totalRealizedProfit(), 1 * USDC);
        assertEq(
            int256(vault.accountedAssets()),
            vault.netLiquidityContributed() + int256(vault.totalRealizedProfit()) - int256(vault.totalRealizedLoss())
        );
    }

    function test_V11_PartialDefaultFortyRecoveryRecordsFiftyNineLoss() public {
        uint256 claimId = _createCertifyAndAdvance(worker, 100 * USDC, keccak256("v11-partial-40"));
        registry.withdrawReserve(platformId, RESERVE_AMOUNT - 40 * USDC);
        uint256 workerBalance = usdc.balanceOf(worker);

        vm.warp(uint256(earnings.getClaim(claimId).dueDate) + 1);
        vault.triggerDefault(claimId);

        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        assertEq(purchase.reserveRecoveryAmount, 40 * USDC);
        assertEq(purchase.realizedProfit, 0);
        assertEq(purchase.realizedLoss, 59 * USDC);
        assertEq(purchase.contractualShortfall, 60 * USDC);
        assertEq(uint256(purchase.status), uint256(AdvanceVaultV2.PurchaseStatus.Defaulted));
        assertEq(vault.totalDefaultRecoveries(), 40 * USDC);
        assertEq(vault.totalRealizedLoss(), 59 * USDC);
        assertEq(vault.totalContractualShortfall(), 60 * USDC);
        assertEq(vault.totalSettledFaceValue(), 0);
        assertEq(usdc.balanceOf(worker), workerBalance);
        assertEq(
            int256(vault.accountedAssets()),
            vault.netLiquidityContributed() + int256(vault.totalRealizedProfit()) - int256(vault.totalRealizedLoss())
        );
    }

    function test_V11_FullReserveRecoveryRemainsDefaultedAndRealizesProfit() public {
        uint256 claimId = _createCertifyAndAdvance(worker, 100 * USDC, keccak256("v11-full-recovery"));
        registry.withdrawReserve(platformId, RESERVE_AMOUNT - 100 * USDC);

        vm.warp(uint256(earnings.getClaim(claimId).dueDate) + 1);
        vault.triggerDefault(claimId);

        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        assertEq(purchase.reserveRecoveryAmount, 100 * USDC);
        assertEq(purchase.realizedProfit, 1 * USDC);
        assertEq(purchase.realizedLoss, 0);
        assertEq(purchase.contractualShortfall, 0);
        assertEq(uint256(purchase.status), uint256(AdvanceVaultV2.PurchaseStatus.Defaulted));
        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Defaulted));
        assertEq(vault.totalSettledFaceValue(), 0);
    }

    function test_V11_ZeroReserveRecoveryRecordsFullPrincipalLoss() public {
        uint256 claimId = _createCertifyAndAdvance(worker, 100 * USDC, keccak256("v11-zero-recovery"));
        registry.withdrawReserve(platformId, RESERVE_AMOUNT);

        vm.warp(uint256(earnings.getClaim(claimId).dueDate) + 1);
        vault.triggerDefault(claimId);

        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        assertEq(purchase.reserveRecoveryAmount, 0);
        assertEq(purchase.realizedProfit, 0);
        assertEq(purchase.realizedLoss, 99 * USDC);
        assertEq(purchase.contractualShortfall, 100 * USDC);
        assertEq(vault.totalRealizedProfit(), 0);
        assertEq(vault.totalRealizedLoss(), 99 * USDC);
    }

    function test_V11_WorkerCannotSettlePlatformObligation() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("v11-worker-settle"));

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.UnauthorizedSettlementPayer.selector, platformId, worker));
        vm.prank(worker);
        vault.settleClaim(claimId);
    }

    function test_V11_RegisteredPlatformWalletCanSettle() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("v11-platform-settle"));
        vm.prank(platformWallet);
        vault.settleClaim(claimId);
        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Settled));
    }

    function test_V11_AuthorizedSettlementOperatorCanSettle() public {
        address operator = makeAddr("settlementOperator");
        vm.prank(platformWallet);
        registry.setSettlementOperator(platformId, operator, true);
        usdc.mint(operator, FACE_VALUE);
        vm.prank(operator);
        usdc.approve(address(vault), FACE_VALUE);

        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("v11-operator-settle"));
        vm.prank(operator);
        vault.settleClaim(claimId);

        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Settled));
    }

    function test_V11_PausedPlatformCanSettleExistingClaim() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("v11-paused-settle"));
        registry.pausePlatform(platformId);

        vm.prank(platformWallet);
        vault.settleClaim(claimId);

        assertEq(uint256(earnings.getClaim(claimId).status), uint256(EarningsManager.ClaimStatus.Settled));
    }

    function test_V11_PurchaseAtDueTimestampReverts() public {
        uint64 dueDate = uint64(block.timestamp + 10);
        vm.prank(platformWallet);
        uint256 claimId = earnings.createClaim(
            platformId, worker, FACE_VALUE, dueDate, keccak256("v11-at-due"), keccak256("evidence")
        );
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);

        vm.warp(dueDate);
        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.ClaimExpired.selector, claimId, dueDate, dueDate));
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    function test_V11_PurchaseOneSecondBeforeDueTimestampSucceeds() public {
        uint64 dueDate = uint64(block.timestamp + 10);
        vm.prank(platformWallet);
        uint256 claimId = earnings.createClaim(
            platformId, worker, FACE_VALUE, dueDate, keccak256("v11-before-due"), keccak256("evidence")
        );
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);

        vm.warp(dueDate - 1);
        vm.prank(worker);
        vault.purchaseAdvance(claimId);

        assertEq(uint256(vault.getPurchase(claimId).status), uint256(AdvanceVaultV2.PurchaseStatus.Outstanding));
    }

    function test_V11_DuplicateDefaultResolutionReverts() public {
        uint256 claimId = _createCertifyAndAdvance(worker, FACE_VALUE, keccak256("v11-double-default"));
        vm.warp(uint256(earnings.getClaim(claimId).dueDate) + 1);
        vault.triggerDefault(claimId);

        vm.expectRevert(
            abi.encodeWithSelector(
                AdvanceVaultV2.ClaimAlreadyResolved.selector, claimId, AdvanceVaultV2.PurchaseStatus.Defaulted
            )
        );
        vault.triggerDefault(claimId);
    }

    function test_V11_CashSurplusAndDeficitAreVisible() public {
        assertTrue(vault.isCashReconciled());
        uint256 accounted = vault.accountedCash();

        usdc.mint(address(vault), 10 * USDC);
        assertEq(vault.accountedCash(), accounted);
        assertEq(vault.actualCash(), accounted + 10 * USDC);
        assertEq(vault.cashSurplus(), 10 * USDC);
        assertEq(vault.cashDeficit(), 0);
        assertFalse(vault.isCashReconciled());

        usdc.burn(address(vault), 11 * USDC);
        assertEq(vault.accountedCash(), accounted);
        assertEq(vault.actualCash(), accounted - 1 * USDC);
        assertEq(vault.cashSurplus(), 0);
        assertEq(vault.cashDeficit(), 1 * USDC);
        assertFalse(vault.isCashReconciled());
    }

    function test_V11_ReservePresenceRequiredForNewExposure() public {
        uint256 noReservePlatform = registry.registerPlatform(platformWallet, CREDIT_LIMIT, FEE_BPS);
        vm.prank(platformWallet);
        uint256 claimId = earnings.createClaim(
            noReservePlatform, worker, FACE_VALUE, _dueDate(), keccak256("v11-no-reserve"), keccak256("evidence")
        );
        vm.prank(platformWallet);
        earnings.certifyClaim(claimId);

        vm.expectRevert(abi.encodeWithSelector(AdvanceVaultV2.ReserveRequirementNotMet.selector, noReservePlatform));
        vm.prank(worker);
        vault.purchaseAdvance(claimId);
    }

    // ================================================================
    //  V1.1 bounded batch certification
    // ================================================================

    function test_V11_BatchCreateAndCertifyValid() public {
        (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        ) = _batchInputs(3);

        vm.prank(platformWallet);
        uint256[] memory claimIds =
            earnings.createAndCertifyClaimsBatch(platformId, workers, faceValues, dueDates, taskHashes, evidenceHashes);

        assertEq(claimIds.length, 3);
        for (uint256 i; i < claimIds.length; ++i) {
            EarningsManager.Claim memory claim = earnings.getClaim(claimIds[i]);
            assertEq(claim.worker, workers[i]);
            assertEq(claim.faceValue, faceValues[i]);
            assertEq(uint256(claim.status), uint256(EarningsManager.ClaimStatus.Certified));
            assertTrue(earnings.isTaskHashUsed(platformId, taskHashes[i]));
        }
    }

    function test_V11_BatchRejectsEmpty() public {
        (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        ) = _batchInputs(0);

        vm.expectRevert(EarningsManager.EmptyBatch.selector);
        vm.prank(platformWallet);
        earnings.createAndCertifyClaimsBatch(platformId, workers, faceValues, dueDates, taskHashes, evidenceHashes);
    }

    function test_V11_BatchRejectsOversized() public {
        uint256 length = earnings.MAX_BATCH_SIZE() + 1;
        (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        ) = _batchInputs(length);

        vm.expectRevert(
            abi.encodeWithSelector(EarningsManager.BatchTooLarge.selector, length, earnings.MAX_BATCH_SIZE())
        );
        vm.prank(platformWallet);
        earnings.createAndCertifyClaimsBatch(platformId, workers, faceValues, dueDates, taskHashes, evidenceHashes);
    }

    function test_V11_BatchRejectsMismatchedArrays() public {
        (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        ) = _batchInputs(2);
        faceValues = new uint256[](1);

        vm.expectRevert(EarningsManager.BatchLengthMismatch.selector);
        vm.prank(platformWallet);
        earnings.createAndCertifyClaimsBatch(platformId, workers, faceValues, dueDates, taskHashes, evidenceHashes);
    }

    function test_V11_BatchRevertsCompletelyWhenOneItemInvalid() public {
        (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        ) = _batchInputs(2);
        workers[1] = address(0);

        vm.expectRevert(EarningsManager.ZeroAddress.selector);
        vm.prank(platformWallet);
        earnings.createAndCertifyClaimsBatch(platformId, workers, faceValues, dueDates, taskHashes, evidenceHashes);

        assertFalse(earnings.isTaskHashUsed(platformId, taskHashes[0]));
        assertFalse(earnings.isTaskHashUsed(platformId, taskHashes[1]));
    }

    function test_V11_BatchRejectsDuplicateTaskIdsAtomically() public {
        (
            address[] memory workers,
            uint256[] memory faceValues,
            uint64[] memory dueDates,
            bytes32[] memory taskHashes,
            bytes32[] memory evidenceHashes
        ) = _batchInputs(2);
        taskHashes[1] = taskHashes[0];

        vm.expectRevert(abi.encodeWithSelector(EarningsManager.TaskHashAlreadyUsed.selector, platformId, taskHashes[0]));
        vm.prank(platformWallet);
        earnings.createAndCertifyClaimsBatch(platformId, workers, faceValues, dueDates, taskHashes, evidenceHashes);

        assertFalse(earnings.isTaskHashUsed(platformId, taskHashes[0]));
    }
}
