// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {FeeOnTransferUSDC} from "./mocks/FeeOnTransferUSDC.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract MandateManagerTest is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant BUDGET = 1_000 * USDC;
    uint256 internal constant MAX_PURCHASE = 500 * USDC;
    uint64 internal constant RELEASE_DELAY = 3 days;

    MockUSDC internal usdc;
    MandateManager internal manager;

    address internal business = makeAddr("business");
    address internal agent = makeAddr("agent");
    address internal approver = makeAddr("approver");
    address internal vendor = makeAddr("vendor");
    address internal otherVendor = makeAddr("otherVendor");
    address internal stranger = makeAddr("stranger");
    address internal advanceVault = makeAddr("advanceVault");

    event AdvanceVaultUpdated(address indexed oldAdvanceVault, address indexed newAdvanceVault);
    event AuthorizedAdvanceVaultFrozen(address indexed vault);

    function setUp() public {
        usdc = new MockUSDC();
        manager = new MandateManager(usdc);

        usdc.mint(business, 10_000 * USDC);
        vm.prank(business);
        usdc.approve(address(manager), type(uint256).max);
    }

    function test_CreateMandateTransfersAndStoresUSDC() public {
        uint256 mandateId = _createMandate(true);

        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        assertEq(mandate.business, business);
        assertEq(mandate.agent, agent);
        assertEq(mandate.approver, approver);
        assertEq(mandate.totalBudget, BUDGET);
        assertEq(mandate.reserved, 0);
        assertEq(mandate.spent, 0);
        assertEq(mandate.defaultReleaseDelaySeconds, RELEASE_DELAY);
        assertEq(mandate.maxPerPurchase, MAX_PURCHASE);
        assertTrue(mandate.proofRequired);
        assertEq(uint256(mandate.status), uint256(MandateManager.MandateStatus.Active));
        assertEq(usdc.balanceOf(address(manager)), BUDGET);
        assertTrue(manager.isVendorAllowed(mandateId, vendor));
        assertEq(manager.availableBudget(mandateId), BUDGET);
    }

    function test_CreateMandateRejectsFeeOnTransferTokenUnderfunding() public {
        FeeOnTransferUSDC feeToken = new FeeOnTransferUSDC();
        MandateManager feeTokenManager = new MandateManager(feeToken);
        feeToken.mint(business, BUDGET);
        vm.prank(business);
        feeToken.approve(address(feeTokenManager), BUDGET);
        address[] memory allowedVendors = new address[](1);
        allowedVendors[0] = vendor;

        vm.expectRevert(
            abi.encodeWithSelector(MandateManager.IncorrectFundingAmount.selector, BUDGET, BUDGET - (BUDGET / 100))
        );
        vm.prank(business);
        feeTokenManager.createMandate(
            agent,
            approver,
            BUDGET,
            uint64(block.timestamp + 7 days),
            RELEASE_DELAY,
            MAX_PURCHASE,
            false,
            keccak256("fee-token-mandate"),
            allowedVendors
        );
    }

    function test_CreateMandateRejectsZeroOrExcessiveReleaseDelay() public {
        address[] memory allowedVendors = new address[](1);
        allowedVendors[0] = vendor;

        vm.expectRevert(abi.encodeWithSelector(MandateManager.InvalidReleaseDelay.selector, uint64(0)));
        vm.prank(business);
        manager.createMandate(
            agent,
            approver,
            BUDGET,
            uint64(block.timestamp + 7 days),
            0,
            MAX_PURCHASE,
            false,
            keccak256("zero-release-delay"),
            allowedVendors
        );

        uint64 excessiveDelay = manager.MAX_RELEASE_DELAY_SECONDS() + 1;
        vm.expectRevert(abi.encodeWithSelector(MandateManager.InvalidReleaseDelay.selector, excessiveDelay));
        vm.prank(business);
        manager.createMandate(
            agent,
            approver,
            BUDGET,
            uint64(block.timestamp + 7 days),
            excessiveDelay,
            MAX_PURCHASE,
            false,
            keccak256("excessive-release-delay"),
            allowedVendors
        );
    }

    function test_NonAgentCannotRequestSpend() public {
        uint256 mandateId = _createMandate(false);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotMandateAgent.selector, mandateId, stranger));
        vm.prank(stranger);
        manager.requestSpend(mandateId, vendor, 100 * USDC, keccak256("ref-1"));
    }

    function test_ExpiredMandateCannotReceiveNewSpendRequest() public {
        uint256 mandateId = _createMandate(false);
        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        vm.warp(mandate.expiresAt);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.MandateExpired.selector, mandateId));
        vm.prank(agent);
        manager.requestSpend(mandateId, vendor, 100 * USDC, keccak256("ref-1"));
    }

    function test_AmountAboveMaxPerPurchaseIsRejected() public {
        uint256 mandateId = _createMandate(false);
        uint256 amount = MAX_PURCHASE + 1;

        vm.expectRevert(
            abi.encodeWithSelector(MandateManager.AmountExceedsMaxPerPurchase.selector, amount, MAX_PURCHASE)
        );
        vm.prank(agent);
        manager.requestSpend(mandateId, vendor, amount, keccak256("ref-1"));
    }

    function test_NonAllowlistedVendorIsRejected() public {
        uint256 mandateId = _createMandate(false);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.VendorNotAllowed.selector, mandateId, otherVendor));
        vm.prank(agent);
        manager.requestSpend(mandateId, otherVendor, 100 * USDC, keccak256("ref-1"));
    }

    function test_DuplicateExternalRefHashIsRejected() public {
        uint256 mandateId = _createMandate(false);
        bytes32 externalRefHash = keccak256("duplicate-ref");
        _requestSpend(mandateId, 100 * USDC, externalRefHash);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.ExternalRefAlreadyUsed.selector, externalRefHash));
        vm.prank(agent);
        manager.requestSpend(mandateId, vendor, 50 * USDC, externalRefHash);
    }

    function test_ApproveSpendEnforcesAndPreservesProofRequirement() public {
        uint256 mandateId = _createMandate(true);
        uint256 spendId = _requestSpend(mandateId, 100 * USDC, keccak256("ref-1"));

        vm.expectRevert(abi.encodeWithSelector(MandateManager.ProofRequired.selector, spendId));
        vm.prank(approver);
        manager.approveSpend(spendId);

        bytes32 proofHash = keccak256("receipt");
        vm.prank(vendor);
        manager.submitProof(spendId, proofHash);
        vm.prank(approver);
        manager.approveSpend(spendId);

        MandateManager.SpendRequest memory spend = manager.getSpendRequest(spendId);
        assertEq(spend.proofHash, proofHash);
        assertEq(uint256(spend.status), uint256(MandateManager.RequestStatus.Approved));
        assertGt(spend.approvedAt, 0);
    }

    function test_LockSpendOnlyWorksAfterApproval() public {
        uint256 mandateId = _createMandate(false);
        uint256 spendId = _requestSpend(mandateId, 100 * USDC, keccak256("ref-1"));

        vm.expectRevert(
            abi.encodeWithSelector(
                MandateManager.InvalidRequestStatus.selector, spendId, MandateManager.RequestStatus.Requested
            )
        );
        vm.prank(approver);
        manager.lockSpend(spendId);
    }

    function test_LockSpendRevertsIfParentMandateIsRevoked() public {
        (uint256 mandateId, uint256 spendId) = _createAndApprove(100 * USDC);
        vm.prank(business);
        manager.revokeMandate(mandateId);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.MandateNotActive.selector, mandateId));
        vm.prank(approver);
        manager.lockSpend(spendId);
    }

    function test_LockSpendRevertsIfParentMandateIsExpired() public {
        (uint256 mandateId, uint256 spendId) = _createAndApprove(100 * USDC);
        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        vm.warp(mandate.expiresAt);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.MandateExpired.selector, mandateId));
        vm.prank(approver);
        manager.lockSpend(spendId);
    }

    function test_CannotRejectLockedClaim() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.expectRevert(
            abi.encodeWithSelector(
                MandateManager.InvalidRequestStatus.selector, spendId, MandateManager.RequestStatus.Locked
            )
        );
        vm.prank(approver);
        manager.rejectSpend(spendId);
    }

    function test_ReleaseSpendPaysRequestPayee() public {
        (uint256 mandateId, uint256 spendId) = _createAndLock(100 * USDC);
        MandateManager.SpendRequest memory beforeRelease = manager.getSpendRequest(spendId);
        assertEq(beforeRelease.payee, vendor);

        uint256 payeeBalanceBefore = usdc.balanceOf(beforeRelease.payee);
        vm.prank(approver);
        manager.releaseSpend(spendId);

        MandateManager.SpendRequest memory spend = manager.getSpendRequest(spendId);
        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        assertEq(usdc.balanceOf(beforeRelease.payee) - payeeBalanceBefore, 100 * USDC);
        assertEq(uint256(spend.status), uint256(MandateManager.RequestStatus.Released));
        assertEq(mandate.reserved, 0);
        assertEq(mandate.spent, 100 * USDC);
    }

    function test_NonApproverCannotReleaseBeforeReleaseDueAt() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        MandateManager.SpendRequest memory spend = manager.getSpendRequest(spendId);
        assertEq(spend.releaseDueAt, spend.lockedAt + RELEASE_DELAY);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotMandateApprover.selector, spend.mandateId, stranger));
        vm.prank(stranger);
        manager.releaseSpend(spendId);
    }

    function test_BusinessCanReleaseBeforeReleaseDueAt() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.prank(business);
        manager.releaseSpend(spendId);

        assertEq(usdc.balanceOf(vendor), 100 * USDC);
        assertEq(uint256(manager.getSpendRequest(spendId).status), uint256(MandateManager.RequestStatus.Released));
    }

    function test_AnyoneCanReleaseAtOrAfterReleaseDueAt() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        MandateManager.SpendRequest memory spend = manager.getSpendRequest(spendId);
        vm.warp(spend.releaseDueAt);

        vm.prank(stranger);
        manager.releaseSpend(spendId);

        assertEq(usdc.balanceOf(vendor), 100 * USDC);
        assertEq(uint256(manager.getSpendRequest(spendId).status), uint256(MandateManager.RequestStatus.Released));
    }

    function test_AssignClaimOnlyWorksForLockedClaims() public {
        (, uint256 spendId) = _createAndApprove(100 * USDC);

        vm.expectRevert(
            abi.encodeWithSelector(
                MandateManager.InvalidRequestStatus.selector, spendId, MandateManager.RequestStatus.Approved
            )
        );
        vm.prank(vendor);
        manager.assignClaim(spendId, otherVendor);
    }

    function test_AssignClaimOnlyCurrentPayee() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotCurrentPayee.selector, spendId, stranger));
        vm.prank(stranger);
        manager.assignClaim(spendId, otherVendor);
    }

    function test_AssignClaimRejectsZeroAddress() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.expectRevert(MandateManager.ZeroAddress.selector);
        vm.prank(vendor);
        manager.assignClaim(spendId, address(0));
    }

    function test_AssignClaimForAdvanceOnlyAuthorizedAdvanceVault() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotAuthorizedAdvanceVault.selector, stranger));
        vm.prank(stranger);
        manager.assignClaimForAdvance(spendId, vendor, advanceVault);
    }

    function test_AssignClaimForAdvanceVerifiesExpectedCurrentPayee() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        manager.setAuthorizedAdvanceVault(advanceVault);

        vm.expectRevert(
            abi.encodeWithSelector(MandateManager.CurrentPayeeMismatch.selector, spendId, otherVendor, vendor)
        );
        vm.prank(advanceVault);
        manager.assignClaimForAdvance(spendId, otherVendor, advanceVault);
    }

    function test_SetAuthorizedAdvanceVaultRejectsZeroAddress() public {
        vm.expectRevert(MandateManager.ZeroAddress.selector);
        manager.setAuthorizedAdvanceVault(address(0));
    }

    function test_SetAuthorizedAdvanceVaultIsOwnerOnlyAndEmitsUpdate() public {
        vm.expectRevert();
        vm.prank(stranger);
        manager.setAuthorizedAdvanceVault(advanceVault);

        vm.expectEmit(true, true, false, false, address(manager));
        emit AdvanceVaultUpdated(address(0), advanceVault);
        manager.setAuthorizedAdvanceVault(advanceVault);

        assertEq(manager.authorizedAdvanceVault(), advanceVault);
    }

    function test_OwnerCanFreezeConfiguredAuthorizedAdvanceVault() public {
        manager.setAuthorizedAdvanceVault(advanceVault);

        vm.expectRevert();
        vm.prank(stranger);
        manager.freezeAuthorizedAdvanceVault();

        vm.expectEmit(true, false, false, false, address(manager));
        emit AuthorizedAdvanceVaultFrozen(advanceVault);
        manager.freezeAuthorizedAdvanceVault();

        assertTrue(manager.authorizedVaultFrozen());
        assertEq(manager.authorizedAdvanceVault(), advanceVault);
    }

    function test_CannotFreezeAuthorizedAdvanceVaultBeforeItIsSet() public {
        vm.expectRevert(MandateManager.AuthorizedAdvanceVaultNotSet.selector);
        manager.freezeAuthorizedAdvanceVault();
    }

    function test_CannotFreezeAuthorizedAdvanceVaultTwice() public {
        manager.setAuthorizedAdvanceVault(advanceVault);
        manager.freezeAuthorizedAdvanceVault();

        vm.expectRevert(MandateManager.AuthorizedAdvanceVaultAlreadyFrozen.selector);
        manager.freezeAuthorizedAdvanceVault();
    }

    function test_CannotChangeAuthorizedAdvanceVaultAfterFreeze() public {
        manager.setAuthorizedAdvanceVault(advanceVault);
        manager.freezeAuthorizedAdvanceVault();

        vm.expectRevert(MandateManager.AuthorizedAdvanceVaultAlreadyFrozen.selector);
        manager.setAuthorizedAdvanceVault(makeAddr("replacementVault"));
    }

    function test_UnauthorizedVaultCannotAssignAfterAuthorizedVaultIsFrozen() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        manager.setAuthorizedAdvanceVault(advanceVault);
        manager.freezeAuthorizedAdvanceVault();

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotAuthorizedAdvanceVault.selector, stranger));
        vm.prank(stranger);
        manager.assignClaimForAdvance(spendId, vendor, stranger);
    }

    function test_DirectCurrentPayeeAssignmentStillWorksAfterVaultFreeze() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        manager.setAuthorizedAdvanceVault(advanceVault);
        manager.freezeAuthorizedAdvanceVault();

        vm.prank(vendor);
        manager.assignClaim(spendId, otherVendor);

        assertEq(manager.getSpendRequest(spendId).payee, otherVendor);
    }

    function test_AuthorizedAdvanceVaultMustAssignClaimToItself() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        manager.setAuthorizedAdvanceVault(advanceVault);

        vm.expectRevert(
            abi.encodeWithSelector(MandateManager.AdvancePayeeMustBeVault.selector, advanceVault, otherVendor)
        );
        vm.prank(advanceVault);
        manager.assignClaimForAdvance(spendId, vendor, otherVendor);
    }

    function test_ChangingAuthorizedVaultDoesNotAffectAlreadyAssignedClaim() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        manager.setAuthorizedAdvanceVault(advanceVault);
        vm.prank(advanceVault);
        manager.assignClaimForAdvance(spendId, vendor, advanceVault);

        address replacementVault = makeAddr("replacementVault");
        manager.setAuthorizedAdvanceVault(replacementVault);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.ClaimAlreadyAdvanced.selector, spendId));
        vm.prank(replacementVault);
        manager.assignClaimForAdvance(spendId, advanceVault, replacementVault);

        vm.prank(approver);
        manager.releaseSpend(spendId);

        assertEq(manager.authorizedAdvanceVault(), replacementVault);
        assertEq(usdc.balanceOf(advanceVault), 100 * USDC);
        assertEq(manager.getSpendRequest(spendId).payee, advanceVault);
    }

    function test_PreviousAuthorizedVaultCannotUseAtomicAssignmentAfterUpdate() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);
        manager.setAuthorizedAdvanceVault(advanceVault);
        address replacementVault = makeAddr("replacementVault");
        manager.setAuthorizedAdvanceVault(replacementVault);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotAuthorizedAdvanceVault.selector, advanceVault));
        vm.prank(advanceVault);
        manager.assignClaimForAdvance(spendId, vendor, advanceVault);
    }

    function test_ReleaseSpendPaysAssignedPayeeNotOriginalVendor() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.prank(vendor);
        manager.assignClaim(spendId, otherVendor);
        vm.prank(approver);
        manager.releaseSpend(spendId);

        MandateManager.SpendRequest memory spend = manager.getSpendRequest(spendId);
        assertEq(spend.vendor, vendor);
        assertEq(spend.payee, otherVendor);
        assertEq(usdc.balanceOf(vendor), 0);
        assertEq(usdc.balanceOf(otherVendor), 100 * USDC);
    }

    function test_OriginalVendorCannotReassignAfterNoLongerBeingPayee() public {
        (, uint256 spendId) = _createAndLock(100 * USDC);

        vm.prank(vendor);
        manager.assignClaim(spendId, otherVendor);

        vm.expectRevert(abi.encodeWithSelector(MandateManager.NotCurrentPayee.selector, spendId, vendor));
        vm.prank(vendor);
        manager.assignClaim(spendId, stranger);
    }

    function test_RevokeMandateDoesNotBlockReleaseOfLockedRequest() public {
        (uint256 mandateId, uint256 spendId) = _createAndLock(100 * USDC);
        vm.prank(business);
        manager.revokeMandate(mandateId);

        vm.prank(approver);
        manager.releaseSpend(spendId);

        assertEq(usdc.balanceOf(vendor), 100 * USDC);
        assertEq(uint256(manager.getSpendRequest(spendId).status), uint256(MandateManager.RequestStatus.Released));
    }

    function test_ReclaimExpiredCannotWithdrawReservedFunds() public {
        (uint256 mandateId, uint256 spendId) = _createAndLock(300 * USDC);
        vm.prank(business);
        manager.revokeMandate(mandateId);

        uint256 businessBalanceBefore = usdc.balanceOf(business);
        vm.prank(business);
        uint256 reclaimed = manager.reclaimExpired(mandateId);

        assertEq(reclaimed, 700 * USDC);
        assertEq(usdc.balanceOf(business) - businessBalanceBefore, 700 * USDC);
        assertEq(usdc.balanceOf(address(manager)), 300 * USDC);
        assertEq(manager.getMandate(mandateId).reserved, 300 * USDC);

        vm.prank(approver);
        manager.releaseSpend(spendId);
        assertEq(usdc.balanceOf(vendor), 300 * USDC);
    }

    function test_LockedClaimCanStillReleaseAfterMandateExpiry() public {
        (uint256 mandateId, uint256 spendId) = _createAndLock(100 * USDC);
        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        vm.warp(mandate.expiresAt + 30 days);

        vm.prank(stranger);
        manager.releaseSpend(spendId);

        assertEq(usdc.balanceOf(vendor), 100 * USDC);
        assertEq(uint256(manager.getSpendRequest(spendId).status), uint256(MandateManager.RequestStatus.Released));
    }

    function test_ReclaimExpiredOnlyWithdrawsUnreservedAndUnspentFunds() public {
        uint256 mandateId = _createMandate(false);
        uint256 releasedSpendId = _requestSpend(mandateId, 200 * USDC, keccak256("released"));
        _approveAndLock(releasedSpendId);
        vm.prank(approver);
        manager.releaseSpend(releasedSpendId);

        uint256 lockedSpendId = _requestSpend(mandateId, 300 * USDC, keccak256("locked"));
        _approveAndLock(lockedSpendId);

        MandateManager.Mandate memory beforeExpiry = manager.getMandate(mandateId);
        vm.warp(beforeExpiry.expiresAt);
        uint256 businessBalanceBefore = usdc.balanceOf(business);

        vm.prank(business);
        uint256 reclaimed = manager.reclaimExpired(mandateId);

        MandateManager.Mandate memory afterReclaim = manager.getMandate(mandateId);
        assertEq(reclaimed, 500 * USDC);
        assertEq(usdc.balanceOf(business) - businessBalanceBefore, 500 * USDC);
        assertEq(afterReclaim.totalBudget, 500 * USDC);
        assertEq(afterReclaim.spent, 200 * USDC);
        assertEq(afterReclaim.reserved, 300 * USDC);
        assertEq(manager.availableBudget(mandateId), 0);
        assertEq(usdc.balanceOf(address(manager)), 300 * USDC);
    }

    function testFuzz_SpentPlusReservedNeverExceedsTotalBudget(uint96 rawFirst, uint96 rawSecond, bool releaseFirst)
        public
    {
        uint256 firstAmount = bound(uint256(rawFirst), 1, MAX_PURCHASE);
        uint256 secondAmount = bound(uint256(rawSecond), 1, MAX_PURCHASE);
        uint256 mandateId = _createMandate(false);

        uint256 firstSpendId = _requestSpend(mandateId, firstAmount, keccak256("fuzz-first"));
        _approveAndLock(firstSpendId);
        uint256 secondSpendId = _requestSpend(mandateId, secondAmount, keccak256("fuzz-second"));
        _approveAndLock(secondSpendId);

        if (releaseFirst) {
            vm.prank(approver);
            manager.releaseSpend(firstSpendId);
        }

        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        assertLe(mandate.spent + mandate.reserved, mandate.totalBudget);
        assertEq(mandate.spent + mandate.reserved, firstAmount + secondAmount);
    }

    function testFuzz_ReleaseMovesExactAmountFromReservedToSpent(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, MAX_PURCHASE);
        (uint256 mandateId, uint256 spendId) = _createAndLock(amount);
        MandateManager.Mandate memory beforeRelease = manager.getMandate(mandateId);

        vm.prank(approver);
        manager.releaseSpend(spendId);

        MandateManager.Mandate memory afterRelease = manager.getMandate(mandateId);
        assertEq(beforeRelease.reserved - afterRelease.reserved, amount);
        assertEq(afterRelease.spent - beforeRelease.spent, amount);
        assertEq(beforeRelease.reserved + beforeRelease.spent, afterRelease.reserved + afterRelease.spent);
    }

    function testFuzz_ReclaimNeverWithdrawsLockedReserve(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, MAX_PURCHASE);
        (uint256 mandateId,) = _createAndLock(amount);
        vm.prank(business);
        manager.revokeMandate(mandateId);

        vm.prank(business);
        manager.reclaimExpired(mandateId);

        MandateManager.Mandate memory mandate = manager.getMandate(mandateId);
        assertEq(mandate.reserved, amount);
        assertEq(mandate.totalBudget, amount);
        assertEq(usdc.balanceOf(address(manager)), amount);
    }

    function _createMandate(bool proofRequired) internal returns (uint256 mandateId) {
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
    }

    function _requestSpend(uint256 mandateId, uint256 amount, bytes32 externalRefHash)
        internal
        returns (uint256 spendId)
    {
        vm.prank(agent);
        spendId = manager.requestSpend(mandateId, vendor, amount, externalRefHash);
    }

    function _createAndApprove(uint256 amount) internal returns (uint256 mandateId, uint256 spendId) {
        mandateId = _createMandate(false);
        spendId = _requestSpend(mandateId, amount, keccak256(abi.encode("approved", mandateId)));
        vm.prank(approver);
        manager.approveSpend(spendId);
    }

    function _createAndLock(uint256 amount) internal returns (uint256 mandateId, uint256 spendId) {
        (mandateId, spendId) = _createAndApprove(amount);
        vm.prank(approver);
        manager.lockSpend(spendId);
    }

    function _approveAndLock(uint256 spendId) internal {
        vm.startPrank(approver);
        manager.approveSpend(spendId);
        manager.lockSpend(spendId);
        vm.stopPrank();
    }
}
