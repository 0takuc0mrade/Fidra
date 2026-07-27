// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {PlatformRegistry} from "../src/PlatformRegistry.sol";
import {EarningsManager} from "../src/EarningsManager.sol";
import {AdvanceVaultV2} from "../src/AdvanceVaultV2.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract FidraV11Handler is Test {
    uint256 internal constant USDC = 1e6;
    uint256 internal constant MAX_PLATFORMS = 4;
    uint256 internal constant MAX_CLAIMS = 40;
    uint256 internal constant INITIAL_LIQUIDITY = 100_000 * USDC;
    uint256 internal constant INITIAL_RESERVE = 5_000 * USDC;

    MockUSDC public immutable usdc;
    PlatformRegistry public immutable registry;
    EarningsManager public immutable earnings;
    AdvanceVaultV2 public immutable vault;

    uint256[] internal _platformIds;
    address[] internal _platformWallets;
    uint256[] internal _claimIds;
    address[] internal _workers;

    mapping(address worker => bool known) internal _knownWorkers;
    mapping(uint256 claimId => uint256 count) public purchaseSuccesses;
    mapping(uint256 claimId => uint256 count) public terminalResolutions;
    mapping(uint256 claimId => bytes32 termsHash) public certifiedTermsHash;
    mapping(uint256 claimId => EarningsManager.ClaimStatus status) public terminalStatus;
    mapping(address worker => uint256 minimumBalance) public completedPayoutFloor;

    bool public duplicatePurchaseSucceeded;
    bool public duplicateSettlementSucceeded;
    bool public duplicateDefaultSucceeded;
    bool public pausedPurchaseSucceeded;
    bool public unauthorizedSettlementSucceeded;
    bool public pausedSettlementFailed;

    uint256 internal _taskNonce;

    constructor() {
        usdc = new MockUSDC();
        registry = new PlatformRegistry(usdc);
        earnings = new EarningsManager(registry);
        vault = new AdvanceVaultV2(address(usdc), address(registry), address(earnings));

        registry.setAuthorizedVault(address(vault));
        earnings.setAuthorizedVault(address(vault));

        usdc.approve(address(registry), type(uint256).max);
        usdc.approve(address(vault), type(uint256).max);

        _registerPlatform(10_000 * USDC, 100);
        _fundReserve(_platformIds[0], INITIAL_RESERVE);

        usdc.mint(address(this), INITIAL_LIQUIDITY);
        vault.depositLiquidity(INITIAL_LIQUIDITY);
    }

    function depositLiquidity(uint256 rawAmount) external {
        uint256 amount = bound(rawAmount, 1, 2_000 * USDC);
        usdc.mint(address(this), amount);
        vault.depositLiquidity(amount);
    }

    function withdrawLiquidity(uint256 rawAmount) external {
        uint256 maximum = _min(vault.accountedCash(), vault.actualCash());
        if (maximum == 0) return;
        vault.withdrawLiquidity(bound(rawAmount, 1, maximum));
    }

    function registerPlatform(uint256 rawCreditLimit, uint256 rawFeeBps) external {
        if (_platformIds.length >= MAX_PLATFORMS) return;
        uint256 creditLimit = bound(rawCreditLimit, 100 * USDC, 50_000 * USDC);
        uint256 feeBps = bound(rawFeeBps, 0, 1_000);
        _registerPlatform(creditLimit, feeBps);
    }

    function setPlatformActive(uint256 platformSeed, bool active) external {
        if (_platformIds.length == 0) return;
        uint256 platformId = _platformIds[platformSeed % _platformIds.length];
        bool current = registry.getPlatform(platformId).active;
        if (active && !current) registry.unpausePlatform(platformId);
        if (!active && current) registry.pausePlatform(platformId);
    }

    function fundReserve(uint256 platformSeed, uint256 rawAmount) external {
        if (_platformIds.length == 0) return;
        uint256 platformId = _platformIds[platformSeed % _platformIds.length];
        _fundReserve(platformId, bound(rawAmount, 1, 2_000 * USDC));
    }

    function createDraft(uint256 platformSeed, uint256 workerSeed, uint256 rawFaceValue, uint256 rawDueOffset)
        external
    {
        if (_claimIds.length >= MAX_CLAIMS || _platformIds.length == 0) return;
        uint256 index = platformSeed % _platformIds.length;
        uint256 platformId = _platformIds[index];
        if (!registry.getPlatform(platformId).active) return;

        address worker = _worker(workerSeed);
        uint256 faceValue = bound(rawFaceValue, 1 * USDC, 500 * USDC);
        uint64 dueDate = uint64(block.timestamp + bound(rawDueOffset, 1, 30 days));
        bytes32 taskHash = keccak256(abi.encode("invariant-task", ++_taskNonce));
        bytes32 evidenceHash = keccak256(abi.encode("invariant-evidence", _taskNonce));

        vm.prank(_platformWallets[index]);
        uint256 claimId = earnings.createClaim(platformId, worker, faceValue, dueDate, taskHash, evidenceHash);
        _claimIds.push(claimId);
        _recordWorker(worker);
    }

    function cancelDraft(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        if (claim.status != EarningsManager.ClaimStatus.Pending) return;

        vm.prank(_walletForPlatform(claim.platformId));
        earnings.cancelClaim(claimId);
    }

    function certifyClaim(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        if (claim.status != EarningsManager.ClaimStatus.Pending || !registry.getPlatform(claim.platformId).active) {
            return;
        }

        vm.prank(_walletForPlatform(claim.platformId));
        earnings.certifyClaim(claimId);
        certifiedTermsHash[claimId] = _termsHash(earnings.getClaim(claimId));
    }

    function purchaseAdvance(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);

        vm.prank(claim.worker);
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.purchaseAdvance, (claimId)));
        if (!success) return;

        purchaseSuccesses[claimId] += 1;
        completedPayoutFloor[claim.worker] = usdc.balanceOf(claim.worker);
    }

    function settleClaim(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (purchase.status != AdvanceVaultV2.PurchaseStatus.Outstanding) return;

        address payer = _walletForPlatform(purchase.platformId);
        vm.prank(payer);
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.settleClaim, (claimId)));
        if (!success) return;

        terminalResolutions[claimId] += 1;
        terminalStatus[claimId] = EarningsManager.ClaimStatus.Settled;
    }

    function settleWhilePaused(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (purchase.status != AdvanceVaultV2.PurchaseStatus.Outstanding) return;

        if (registry.getPlatform(purchase.platformId).active) {
            registry.pausePlatform(purchase.platformId);
        }

        address payer = _walletForPlatform(purchase.platformId);
        vm.prank(payer);
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.settleClaim, (claimId)));
        if (!success) {
            pausedSettlementFailed = true;
            return;
        }

        terminalResolutions[claimId] += 1;
        terminalStatus[claimId] = EarningsManager.ClaimStatus.Settled;
    }

    function advanceTime(uint256 rawSeconds) external {
        vm.warp(block.timestamp + bound(rawSeconds, 1, 15 days));
    }

    function triggerFullReserveDefault(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (purchase.status != AdvanceVaultV2.PurchaseStatus.Outstanding || block.timestamp <= purchase.dueDate) {
            return;
        }

        uint256 reserve = registry.getPlatform(purchase.platformId).reserveBalance;
        if (reserve < purchase.faceValue) {
            _fundReserve(purchase.platformId, purchase.faceValue - reserve);
        }
        vault.triggerDefault(claimId);
        terminalResolutions[claimId] += 1;
        terminalStatus[claimId] = EarningsManager.ClaimStatus.Defaulted;
    }

    function triggerPartialReserveDefault(uint256 claimSeed, uint256 rawRecovery) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (
            purchase.status != AdvanceVaultV2.PurchaseStatus.Outstanding || block.timestamp <= purchase.dueDate
                || purchase.faceValue == 0
        ) return;

        uint256 targetRecovery = bound(rawRecovery, 0, purchase.faceValue - 1);
        uint256 reserve = registry.getPlatform(purchase.platformId).reserveBalance;
        if (reserve > targetRecovery) {
            registry.withdrawReserve(purchase.platformId, reserve - targetRecovery);
        } else if (reserve < targetRecovery) {
            _fundReserve(purchase.platformId, targetRecovery - reserve);
        }

        vault.triggerDefault(claimId);
        terminalResolutions[claimId] += 1;
        terminalStatus[claimId] = EarningsManager.ClaimStatus.Defaulted;
    }

    function attemptDuplicatePurchase(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (purchase.status == AdvanceVaultV2.PurchaseStatus.None) return;

        vm.prank(purchase.worker);
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.purchaseAdvance, (claimId)));
        if (success) duplicatePurchaseSucceeded = true;
    }

    function attemptDuplicateSettlement(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (
            purchase.status != AdvanceVaultV2.PurchaseStatus.Settled
                && purchase.status != AdvanceVaultV2.PurchaseStatus.Defaulted
        ) return;

        vm.prank(_walletForPlatform(purchase.platformId));
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.settleClaim, (claimId)));
        if (success) duplicateSettlementSucceeded = true;
    }

    function attemptDuplicateDefault(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (
            purchase.status != AdvanceVaultV2.PurchaseStatus.Settled
                && purchase.status != AdvanceVaultV2.PurchaseStatus.Defaulted
        ) return;

        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.triggerDefault, (claimId)));
        if (success) duplicateDefaultSucceeded = true;
    }

    function attemptPausedPurchase(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        EarningsManager.Claim memory claim = earnings.getClaim(claimId);
        if (claim.status != EarningsManager.ClaimStatus.Certified) return;

        if (registry.getPlatform(claim.platformId).active) registry.pausePlatform(claim.platformId);
        vm.prank(claim.worker);
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.purchaseAdvance, (claimId)));
        if (success) pausedPurchaseSucceeded = true;
    }

    function attemptUnauthorizedSettlement(uint256 claimSeed) external {
        if (_claimIds.length == 0) return;
        uint256 claimId = _claimIds[claimSeed % _claimIds.length];
        AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
        if (purchase.status != AdvanceVaultV2.PurchaseStatus.Outstanding) return;

        vm.prank(purchase.worker);
        (bool success,) = address(vault).call(abi.encodeCall(AdvanceVaultV2.settleClaim, (claimId)));
        if (success) unauthorizedSettlementSucceeded = true;
    }

    function perturbVaultCash(uint256 rawAmount, bool createSurplus) external {
        if (createSurplus) {
            usdc.mint(address(vault), bound(rawAmount, 1, 500 * USDC));
            return;
        }

        uint256 actual = vault.actualCash();
        if (actual == 0) return;
        usdc.burn(address(vault), bound(rawAmount, 1, actual));
    }

    function platformCount() external view returns (uint256) {
        return _platformIds.length;
    }

    function platformIdAt(uint256 index) external view returns (uint256) {
        return _platformIds[index];
    }

    function claimCount() external view returns (uint256) {
        return _claimIds.length;
    }

    function claimIdAt(uint256 index) external view returns (uint256) {
        return _claimIds[index];
    }

    function workerCount() external view returns (uint256) {
        return _workers.length;
    }

    function workerAt(uint256 index) external view returns (address) {
        return _workers[index];
    }

    function _registerPlatform(uint256 creditLimit, uint256 feeBps) internal {
        address wallet = address(uint160(0x1000 + _platformIds.length));
        uint256 platformId = registry.registerPlatform(wallet, creditLimit, feeBps);
        _platformIds.push(platformId);
        _platformWallets.push(wallet);

        usdc.mint(wallet, 1_000_000 * USDC);
        vm.prank(wallet);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _fundReserve(uint256 platformId, uint256 amount) internal {
        if (amount == 0) return;
        usdc.mint(address(this), amount);
        registry.depositReserve(platformId, amount);
    }

    function _worker(uint256 seed) internal pure returns (address) {
        return address(uint160(0x2000 + (seed % 8)));
    }

    function _recordWorker(address worker) internal {
        if (_knownWorkers[worker]) return;
        _knownWorkers[worker] = true;
        _workers.push(worker);
    }

    function _walletForPlatform(uint256 platformId) internal view returns (address) {
        for (uint256 i; i < _platformIds.length; ++i) {
            if (_platformIds[i] == platformId) return _platformWallets[i];
        }
        revert("unknown platform");
    }

    function _termsHash(EarningsManager.Claim memory claim) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                claim.platformId, claim.worker, claim.faceValue, claim.dueDate, claim.taskHash, claim.evidenceHash
            )
        );
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract FidraV11InvariantTest is StdInvariant, Test {
    FidraV11Handler internal handler;
    MockUSDC internal usdc;
    PlatformRegistry internal registry;
    EarningsManager internal earnings;
    AdvanceVaultV2 internal vault;

    function setUp() public {
        handler = new FidraV11Handler();
        usdc = handler.usdc();
        registry = handler.registry();
        earnings = handler.earnings();
        vault = handler.vault();

        bytes4[] memory selectors = new bytes4[](17);
        selectors[0] = handler.depositLiquidity.selector;
        selectors[1] = handler.withdrawLiquidity.selector;
        selectors[2] = handler.registerPlatform.selector;
        selectors[3] = handler.setPlatformActive.selector;
        selectors[4] = handler.fundReserve.selector;
        selectors[5] = handler.createDraft.selector;
        selectors[6] = handler.cancelDraft.selector;
        selectors[7] = handler.certifyClaim.selector;
        selectors[8] = handler.purchaseAdvance.selector;
        selectors[9] = handler.settleClaim.selector;
        selectors[10] = handler.settleWhilePaused.selector;
        selectors[11] = handler.advanceTime.selector;
        selectors[12] = handler.triggerFullReserveDefault.selector;
        selectors[13] = handler.triggerPartialReserveDefault.selector;
        selectors[14] = handler.attemptDuplicatePurchase.selector;
        selectors[15] = handler.attemptDuplicateSettlement.selector;
        selectors[16] = handler.attemptDuplicateDefault.selector;

        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));

        bytes4[] memory adversarialSelectors = new bytes4[](3);
        adversarialSelectors[0] = handler.attemptPausedPurchase.selector;
        adversarialSelectors[1] = handler.attemptUnauthorizedSettlement.selector;
        adversarialSelectors[2] = handler.perturbVaultCash.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: adversarialSelectors}));
        targetContract(address(handler));
    }

    function invariant_accountingConservationAndCashVisibility() public view {
        assertEq(vault.accountedAssets(), vault.accountedCash() + vault.outstandingPrincipal());

        int256 expectedAssets =
            vault.netLiquidityContributed() + int256(vault.totalRealizedProfit()) - int256(vault.totalRealizedLoss());
        assertGe(expectedAssets, 0);
        assertEq(int256(vault.accountedAssets()), expectedAssets);

        uint256 actual = vault.actualCash();
        uint256 accounted = vault.accountedCash();
        assertEq(vault.cashSurplus(), actual > accounted ? actual - accounted : 0);
        assertEq(vault.cashDeficit(), accounted > actual ? accounted - actual : 0);
        assertEq(vault.isCashReconciled(), actual == accounted);
    }

    function invariant_outstandingAndPlatformExposureMatchPurchases() public view {
        uint256 faceSum;
        uint256 principalSum;
        uint256 platformCount = handler.platformCount();
        uint256[] memory platformExposure = new uint256[](platformCount);

        for (uint256 i; i < handler.claimCount(); ++i) {
            uint256 claimId = handler.claimIdAt(i);
            AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(claimId);
            if (purchase.status != AdvanceVaultV2.PurchaseStatus.Outstanding) continue;

            faceSum += purchase.faceValue;
            principalSum += purchase.advanceAmount;
            for (uint256 j; j < platformCount; ++j) {
                if (handler.platformIdAt(j) == purchase.platformId) {
                    platformExposure[j] += purchase.faceValue;
                    break;
                }
            }
        }

        assertEq(vault.outstandingFaceValue(), faceSum);
        assertEq(vault.outstandingPrincipal(), principalSum);
        for (uint256 i; i < platformCount; ++i) {
            assertEq(registry.getPlatform(handler.platformIdAt(i)).outstandingExposure, platformExposure[i]);
        }
    }

    function invariant_singlePurchaseSingleResolutionAndTerminalMonotonicity() public view {
        assertFalse(handler.duplicatePurchaseSucceeded());
        assertFalse(handler.duplicateSettlementSucceeded());
        assertFalse(handler.duplicateDefaultSucceeded());

        for (uint256 i; i < handler.claimCount(); ++i) {
            uint256 claimId = handler.claimIdAt(i);
            assertLe(handler.purchaseSuccesses(claimId), 1);
            assertLe(handler.terminalResolutions(claimId), 1);

            EarningsManager.ClaimStatus terminal = handler.terminalStatus(claimId);
            if (terminal != EarningsManager.ClaimStatus.None) {
                assertEq(uint256(earnings.getClaim(claimId).status), uint256(terminal));
            }
        }
    }

    function invariant_certifiedClaimTermsAreImmutable() public view {
        for (uint256 i; i < handler.claimCount(); ++i) {
            uint256 claimId = handler.claimIdAt(i);
            bytes32 expected = handler.certifiedTermsHash(claimId);
            if (expected == bytes32(0)) continue;
            assertEq(expected, _termsHash(earnings.getClaim(claimId)));
        }
    }

    function invariant_workersProtectedAndSettlementAuthorized() public view {
        assertFalse(handler.unauthorizedSettlementSucceeded());
        for (uint256 i; i < handler.workerCount(); ++i) {
            address worker = handler.workerAt(i);
            assertGe(usdc.balanceOf(worker), handler.completedPayoutFloor(worker));
        }
    }

    function invariant_pauseRulesHold() public view {
        assertFalse(handler.pausedPurchaseSucceeded());
        assertFalse(handler.pausedSettlementFailed());
    }

    function invariant_reservesReconcileAndProfitRequiresPrincipalRecovery() public view {
        uint256 reserveSum;
        for (uint256 i; i < handler.platformCount(); ++i) {
            reserveSum += registry.getPlatform(handler.platformIdAt(i)).reserveBalance;
        }
        assertEq(registry.totalAccountedReserves(), reserveSum);
        assertEq(registry.actualReserveCash(), reserveSum);
        assertTrue(registry.isReserveCashReconciled());

        for (uint256 i; i < handler.claimCount(); ++i) {
            AdvanceVaultV2.Purchase memory purchase = vault.getPurchase(handler.claimIdAt(i));
            if (purchase.status != AdvanceVaultV2.PurchaseStatus.Defaulted) continue;
            if (purchase.reserveRecoveryAmount < purchase.advanceAmount) {
                assertEq(purchase.realizedProfit, 0);
                assertEq(purchase.realizedLoss, purchase.advanceAmount - purchase.reserveRecoveryAmount);
            }
        }
    }

    function _termsHash(EarningsManager.Claim memory claim) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                claim.platformId, claim.worker, claim.faceValue, claim.dueDate, claim.taskHash, claim.evidenceHash
            )
        );
    }
}
