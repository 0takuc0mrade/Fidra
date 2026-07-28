// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PlatformRegistry} from "../src/PlatformRegistry.sol";
import {AdvanceVaultV2} from "../src/AdvanceVaultV2.sol";

/// @notice Funds one V1.1 platform reserve and the V1.1 vault with deliberately small test amounts.
/// @dev The registry and vault currently require their owner to provide these funds.
contract FundFidraV11 is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant MAX_RESERVE = 2_000_000;
    uint256 internal constant MAX_LIQUIDITY = 10_000_000;

    struct Config {
        address owner;
        address usdc;
        address registry;
        address vault;
        uint256 platformId;
        uint256 reserveAmount;
        uint256 liquidityAmount;
    }

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroAddress(string field);
    error WrongUsdc(address actual, address expected);
    error InvalidFundingAmount(string field, uint256 amount);
    error InvalidOwner(address actual, address expected);
    error InsufficientUsdc(uint256 required, uint256 available);
    error BroadcastNotConfirmed();
    error FundingInvariantFailed(string invariantName);

    function run() external {
        Config memory config = Config({
            owner: vm.envAddress("V1_OWNER_ADDRESS"),
            usdc: vm.envAddress("USDC_ADDRESS"),
            registry: vm.envAddress("V1_PLATFORM_REGISTRY_ADDRESS"),
            vault: vm.envAddress("V1_ADVANCE_VAULT_ADDRESS"),
            platformId: vm.envUint("V1_PLATFORM_ID"),
            reserveAmount: vm.envUint("V1_RESERVE_AMOUNT"),
            liquidityAmount: vm.envUint("V1_VAULT_LIQUIDITY")
        });

        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }
        _requireNonzero("owner", config.owner);
        _requireNonzero("USDC", config.usdc);
        _requireNonzero("registry", config.registry);
        _requireNonzero("vault", config.vault);
        if (config.usdc != ARC_USDC) revert WrongUsdc(config.usdc, ARC_USDC);
        if (config.reserveAmount == 0 || config.reserveAmount > MAX_RESERVE) {
            revert InvalidFundingAmount("reserve", config.reserveAmount);
        }
        if (config.liquidityAmount == 0 || config.liquidityAmount > MAX_LIQUIDITY) {
            revert InvalidFundingAmount("vault liquidity", config.liquidityAmount);
        }

        PlatformRegistry registry = PlatformRegistry(config.registry);
        AdvanceVaultV2 vault = AdvanceVaultV2(config.vault);
        if (registry.owner() != config.owner) revert InvalidOwner(registry.owner(), config.owner);
        if (vault.owner() != config.owner) revert InvalidOwner(vault.owner(), config.owner);
        if (address(registry.usdc()) != config.usdc || address(vault.usdc()) != config.usdc) {
            revert WrongUsdc(address(vault.usdc()), config.usdc);
        }

        IERC20 usdc = IERC20(config.usdc);
        uint256 required = config.reserveAmount + config.liquidityAmount;
        uint256 balance = usdc.balanceOf(config.owner);
        if (balance < required) revert InsufficientUsdc(required, balance);

        bool broadcast =
            vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
        if (broadcast && !vm.envOr("V1_BROADCAST_CONFIRMED", false)) {
            revert BroadcastNotConfirmed();
        }

        console2.log("Fidra V1.1 Arc Testnet funding");
        console2.log("Mode:", broadcast ? "BROADCAST" : "DRY RUN");
        console2.log("Owner/funding wallet:", config.owner);
        console2.log("PlatformRegistry:", config.registry);
        console2.log("AdvanceVaultV2:", config.vault);
        console2.log("Platform ID:", config.platformId);
        console2.log("Reserve amount (6-decimal units):", config.reserveAmount);
        console2.log("Vault liquidity (6-decimal units):", config.liquidityAmount);
        console2.log("Owner USDC balance (6-decimal units):", balance);

        uint256 reserveBefore = registry.getPlatform(config.platformId).reserveBalance;
        uint256 registryCashBefore = registry.actualReserveCash();
        uint256 vaultCashBefore = vault.accountedCash();
        uint256 vaultActualBefore = vault.actualCash();

        vm.startBroadcast();
        usdc.approve(config.registry, config.reserveAmount);
        registry.depositReserve(config.platformId, config.reserveAmount);
        usdc.approve(config.vault, config.liquidityAmount);
        vault.depositLiquidity(config.liquidityAmount);
        vm.stopBroadcast();

        if (registry.getPlatform(config.platformId).reserveBalance != reserveBefore + config.reserveAmount) {
            revert FundingInvariantFailed("platform reserve");
        }
        if (registry.actualReserveCash() != registryCashBefore + config.reserveAmount) {
            revert FundingInvariantFailed("registry reserve custody");
        }
        if (vault.accountedCash() != vaultCashBefore + config.liquidityAmount) {
            revert FundingInvariantFailed("accounted vault cash");
        }
        if (vault.actualCash() != vaultActualBefore + config.liquidityAmount) {
            revert FundingInvariantFailed("actual vault cash");
        }
        if (!vault.isCashReconciled() || !registry.isReserveCashReconciled()) {
            revert FundingInvariantFailed("cash reconciliation");
        }
    }

    function _requireNonzero(string memory field, address value) internal pure {
        if (value == address(0)) revert ZeroAddress(field);
    }
}
