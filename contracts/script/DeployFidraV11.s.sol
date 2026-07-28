// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {PlatformRegistry} from "../src/PlatformRegistry.sol";
import {EarningsManager} from "../src/EarningsManager.sol";
import {AdvanceVaultV2} from "../src/AdvanceVaultV2.sol";

/// @notice Deploys fresh Fidra V1.1 contracts and configures one controlled Arc Testnet platform.
/// @dev A CLI signer supplies the broadcaster. Broadcast mode additionally requires
///      V1_BROADCAST_CONFIRMED=true. This script never reads a raw private key.
contract DeployFidraV11 is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant LEGACY_MANDATE_MANAGER = 0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2;
    address internal constant LEGACY_ADVANCE_VAULT = 0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B;
    uint8 internal constant USDC_DECIMALS = 6;
    uint256 internal constant MAX_TEST_CREDIT_LIMIT = 10_000_000;

    struct Config {
        address expectedOwner;
        address usdc;
        address platformSettlementWallet;
        address workerWallet;
        address liquidityProviderWallet;
        address reserveProviderWallet;
        uint256 creditLimit;
        uint256 advanceFeeBps;
    }

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroAddress(string field);
    error WrongUsdc(address actual, address expected);
    error UsdcHasNoCode(address usdc);
    error WrongUsdcDecimals(uint8 actual, uint8 expected);
    error InvalidRoleAssignment(string field, address actual, address expected);
    error WorkerMustDifferFromPlatform(address worker);
    error InvalidCreditLimit(uint256 creditLimit);
    error InvalidFee(uint256 feeBps);
    error BroadcastNotConfirmed();
    error DeploymentInvariantFailed(string invariantName);
    error LegacyAddressReused(address deployed);

    function run()
        external
        returns (PlatformRegistry registry, EarningsManager earnings, AdvanceVaultV2 vault, uint256 platformId)
    {
        Config memory config = _loadConfig();
        _validatePreflight(config);

        bool broadcast =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (broadcast && !vm.envOr("V1_BROADCAST_CONFIRMED", false)) {
            revert BroadcastNotConfirmed();
        }

        console2.log("Fidra V1.1 controlled Arc Testnet deployment");
        console2.log("Mode:", broadcast ? "BROADCAST" : "DRY RUN");
        console2.log("Git commit:", vm.envString("V1_GIT_COMMIT"));
        console2.log("Chain ID:", block.chainid);
        console2.log("USDC:", config.usdc);
        console2.log("Expected owner:", config.expectedOwner);
        console2.log("Platform settlement wallet:", config.platformSettlementWallet);
        console2.log("Worker wallet:", config.workerWallet);
        console2.log("Liquidity provider:", config.liquidityProviderWallet);
        console2.log("Reserve provider:", config.reserveProviderWallet);
        console2.log("Credit limit (6-decimal units):", config.creditLimit);
        console2.log("Advance fee (bps):", config.advanceFeeBps);

        vm.startBroadcast();

        registry = new PlatformRegistry(IERC20(config.usdc));
        earnings = new EarningsManager(registry);
        vault = new AdvanceVaultV2(config.usdc, address(registry), address(earnings));
        registry.setAuthorizedVault(address(vault));
        earnings.setAuthorizedVault(address(vault));
        platformId =
            registry.registerPlatform(config.platformSettlementWallet, config.creditLimit, config.advanceFeeBps);

        vm.stopBroadcast();

        _validateDeployment(config, registry, earnings, vault, platformId);

        console2.log("PlatformRegistry:", address(registry));
        console2.log("EarningsManager:", address(earnings));
        console2.log("AdvanceVaultV2:", address(vault));
        console2.log("Platform ID:", platformId);
        console2.log("ArcScan registry:");
        console2.log(string.concat("https://testnet.arcscan.app/address/", vm.toString(address(registry))));
        console2.log("ArcScan earnings manager:");
        console2.log(string.concat("https://testnet.arcscan.app/address/", vm.toString(address(earnings))));
        console2.log("ArcScan vault:");
        console2.log(string.concat("https://testnet.arcscan.app/address/", vm.toString(address(vault))));
        console2.log("No reserve or vault liquidity was transferred by this deployment script.");
    }

    function _loadConfig() internal view returns (Config memory config) {
        config = Config({
            expectedOwner: vm.envAddress("V1_OWNER_ADDRESS"),
            usdc: vm.envAddress("USDC_ADDRESS"),
            platformSettlementWallet: vm.envAddress("PLATFORM_SETTLEMENT_WALLET"),
            workerWallet: vm.envAddress("WORKER_WALLET"),
            liquidityProviderWallet: vm.envAddress("LIQUIDITY_PROVIDER_WALLET"),
            reserveProviderWallet: vm.envAddress("RESERVE_PROVIDER_WALLET"),
            creditLimit: vm.envUint("V1_CREDIT_LIMIT"),
            advanceFeeBps: vm.envUint("V1_ADVANCE_FEE_BPS")
        });
    }

    function _validatePreflight(Config memory config) internal view {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }
        _requireNonzero("V1 owner", config.expectedOwner);
        _requireNonzero("USDC", config.usdc);
        _requireNonzero("platform settlement wallet", config.platformSettlementWallet);
        _requireNonzero("worker wallet", config.workerWallet);
        _requireNonzero("liquidity provider", config.liquidityProviderWallet);
        _requireNonzero("reserve provider", config.reserveProviderWallet);
        if (config.usdc != ARC_USDC) revert WrongUsdc(config.usdc, ARC_USDC);
        if (config.usdc.code.length == 0) revert UsdcHasNoCode(config.usdc);
        uint8 decimals = IERC20Metadata(config.usdc).decimals();
        if (decimals != USDC_DECIMALS) revert WrongUsdcDecimals(decimals, USDC_DECIMALS);
        if (config.workerWallet == config.platformSettlementWallet) {
            revert WorkerMustDifferFromPlatform(config.workerWallet);
        }
        if (config.liquidityProviderWallet != config.expectedOwner) {
            revert InvalidRoleAssignment(
                "liquidity provider must be the V1.1 vault owner", config.liquidityProviderWallet, config.expectedOwner
            );
        }
        if (config.reserveProviderWallet != config.expectedOwner) {
            revert InvalidRoleAssignment(
                "reserve provider must be the V1.1 registry owner", config.reserveProviderWallet, config.expectedOwner
            );
        }
        if (config.creditLimit == 0 || config.creditLimit > MAX_TEST_CREDIT_LIMIT) {
            revert InvalidCreditLimit(config.creditLimit);
        }
        if (config.advanceFeeBps == 0 || config.advanceFeeBps > registryMaxFee()) {
            revert InvalidFee(config.advanceFeeBps);
        }
    }

    function _validateDeployment(
        Config memory config,
        PlatformRegistry registry,
        EarningsManager earnings,
        AdvanceVaultV2 vault,
        uint256 platformId
    ) internal view {
        if (
            address(registry) == LEGACY_MANDATE_MANAGER || address(registry) == LEGACY_ADVANCE_VAULT
                || address(earnings) == LEGACY_MANDATE_MANAGER || address(earnings) == LEGACY_ADVANCE_VAULT
                || address(vault) == LEGACY_MANDATE_MANAGER || address(vault) == LEGACY_ADVANCE_VAULT
        ) {
            revert LegacyAddressReused(address(vault));
        }
        if (
            registry.owner() != config.expectedOwner || earnings.owner() != config.expectedOwner
                || vault.owner() != config.expectedOwner
        ) {
            revert DeploymentInvariantFailed("owner assignments");
        }
        if (
            address(registry.usdc()) != config.usdc || address(vault.usdc()) != config.usdc
                || address(earnings.registry()) != address(registry) || address(vault.registry()) != address(registry)
                || address(vault.earnings()) != address(earnings)
        ) {
            revert DeploymentInvariantFailed("constructor linkage");
        }
        if (registry.authorizedVault() != address(vault) || earnings.authorizedVault() != address(vault)) {
            revert DeploymentInvariantFailed("vault authorization");
        }

        PlatformRegistry.Platform memory platform = registry.getPlatform(platformId);
        if (
            platformId != 1 || platform.settlementWallet != config.platformSettlementWallet || !platform.active
                || platform.creditLimit != config.creditLimit || platform.outstandingExposure != 0
                || platform.reserveBalance != 0 || platform.advanceFeeBps != config.advanceFeeBps
        ) {
            revert DeploymentInvariantFailed("initial platform configuration");
        }
    }

    function _requireNonzero(string memory field, address value) internal pure {
        if (value == address(0)) revert ZeroAddress(field);
    }

    function registryMaxFee() internal pure returns (uint256) {
        return 3_000;
    }
}
