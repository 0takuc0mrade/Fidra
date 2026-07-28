// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {PlatformRegistry} from "../src/PlatformRegistry.sol";
import {EarningsManager} from "../src/EarningsManager.sol";
import {AdvanceVaultV2} from "../src/AdvanceVaultV2.sol";

/// @notice Reads V1.1 deployment configuration and accounting directly from Arc Testnet.
contract CheckFidraV11Deployment is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant LEGACY_MANDATE_MANAGER = 0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2;
    address internal constant LEGACY_ADVANCE_VAULT = 0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B;

    error WrongChain(uint256 actual, uint256 expected);
    error InvalidAddress(string field, address value);
    error AddressHasNoCode(string field, address value);
    error UnexpectedAddress(string field, address actual, address expected);
    error UnexpectedUint(string field, uint256 actual, uint256 expected);
    error UnexpectedBool(string field, bool actual, bool expected);
    error ConservationFailure();
    error LegacyAddressReused(string field, address value);

    function run() external view {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }

        address owner = vm.envAddress("V1_OWNER_ADDRESS");
        address platformWallet = vm.envAddress("PLATFORM_SETTLEMENT_WALLET");
        address registryAddress = vm.envAddress("V1_PLATFORM_REGISTRY_ADDRESS");
        address earningsAddress = vm.envAddress("V1_EARNINGS_MANAGER_ADDRESS");
        address vaultAddress = vm.envAddress("V1_ADVANCE_VAULT_ADDRESS");
        uint256 platformId = vm.envUint("V1_PLATFORM_ID");
        uint256 creditLimit = vm.envUint("V1_CREDIT_LIMIT");
        uint256 feeBps = vm.envUint("V1_ADVANCE_FEE_BPS");

        _requireFreshContract("PlatformRegistry", registryAddress);
        _requireFreshContract("EarningsManager", earningsAddress);
        _requireFreshContract("AdvanceVaultV2", vaultAddress);
        _expectAddress("USDC", vm.envAddress("USDC_ADDRESS"), ARC_USDC);

        PlatformRegistry registry = PlatformRegistry(registryAddress);
        EarningsManager earnings = EarningsManager(earningsAddress);
        AdvanceVaultV2 vault = AdvanceVaultV2(vaultAddress);
        PlatformRegistry.Platform memory platform = registry.getPlatform(platformId);

        _expectAddress("registry owner", registry.owner(), owner);
        _expectAddress("earnings owner", earnings.owner(), owner);
        _expectAddress("vault owner", vault.owner(), owner);
        _expectAddress("registry USDC", address(registry.usdc()), ARC_USDC);
        _expectAddress("vault USDC", address(vault.usdc()), ARC_USDC);
        _expectAddress("earnings registry", address(earnings.registry()), registryAddress);
        _expectAddress("vault registry", address(vault.registry()), registryAddress);
        _expectAddress("vault earnings", address(vault.earnings()), earningsAddress);
        _expectAddress("registry authorized vault", registry.authorizedVault(), vaultAddress);
        _expectAddress("earnings authorized vault", earnings.authorizedVault(), vaultAddress);
        _expectAddress("platform settlement wallet", platform.settlementWallet, platformWallet);
        _expectUint("platform credit limit", platform.creditLimit, creditLimit);
        _expectUint("platform fee bps", platform.advanceFeeBps, feeBps);
        _expectUint("USDC decimals", IERC20Metadata(ARC_USDC).decimals(), 6);

        int256 expectedAssets =
            vault.netLiquidityContributed() + int256(vault.totalRealizedProfit()) - int256(vault.totalRealizedLoss());
        if (expectedAssets < 0 || uint256(expectedAssets) != vault.accountedAssets()) {
            revert ConservationFailure();
        }
        _expectUint("accounted assets", vault.accountedAssets(), vault.accountedCash() + vault.outstandingPrincipal());
        _expectBool("cash reconciliation", vault.isCashReconciled(), vault.actualCash() == vault.accountedCash());
        _expectBool(
            "reserve reconciliation",
            registry.isReserveCashReconciled(),
            registry.actualReserveCash() == registry.totalAccountedReserves()
        );

        console2.log("Fidra V1.1 Arc Testnet state verified");
        console2.log("PlatformRegistry:", registryAddress);
        console2.log("EarningsManager:", earningsAddress);
        console2.log("AdvanceVaultV2:", vaultAddress);
        console2.log("Owner:", owner);
        console2.log("Platform ID:", platformId);
        console2.log("Platform settlement wallet:", platform.settlementWallet);
        console2.log("Platform active:", platform.active);
        console2.log("Platform credit limit:", platform.creditLimit);
        console2.log("Platform exposure:", platform.outstandingExposure);
        console2.log("Platform reserve:", platform.reserveBalance);
        console2.log("Accounted cash:", vault.accountedCash());
        console2.log("Actual cash:", vault.actualCash());
        console2.log("Accounted assets:", vault.accountedAssets());
        console2.log("Outstanding principal:", vault.outstandingPrincipal());
        console2.log("Outstanding face value:", vault.outstandingFaceValue());
        console2.log("Net liquidity contributed:");
        console2.logInt(vault.netLiquidityContributed());
        console2.log("Total advance principal:", vault.totalAdvancePrincipal());
        console2.log("Total settled face value:", vault.totalSettledFaceValue());
        console2.log("Total default recoveries:", vault.totalDefaultRecoveries());
        console2.log("Total realized profit:", vault.totalRealizedProfit());
        console2.log("Total realized loss:", vault.totalRealizedLoss());
        console2.log("Total contractual shortfall:", vault.totalContractualShortfall());
        console2.log("Cash surplus:", vault.cashSurplus());
        console2.log("Cash deficit:", vault.cashDeficit());
        console2.log("Cash reconciled:", vault.isCashReconciled());
    }

    function _requireFreshContract(string memory field, address value) internal view {
        if (value == address(0)) revert InvalidAddress(field, value);
        if (value == LEGACY_MANDATE_MANAGER || value == LEGACY_ADVANCE_VAULT) {
            revert LegacyAddressReused(field, value);
        }
        if (value.code.length == 0) revert AddressHasNoCode(field, value);
    }

    function _expectAddress(string memory field, address actual, address expected) internal pure {
        if (actual != expected) revert UnexpectedAddress(field, actual, expected);
    }

    function _expectUint(string memory field, uint256 actual, uint256 expected) internal pure {
        if (actual != expected) revert UnexpectedUint(field, actual, expected);
    }

    function _expectBool(string memory field, bool actual, bool expected) internal pure {
        if (actual != expected) revert UnexpectedBool(field, actual, expected);
    }
}
