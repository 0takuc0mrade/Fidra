// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {AdvanceVault} from "../src/AdvanceVault.sol";

/// @notice Reads and validates a configured Fidra deployment without broadcasting transactions.
contract CheckFidraDeployment is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant DEPLOYED_MANAGER = 0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2;
    address internal constant DEPLOYED_VAULT = 0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B;
    address internal constant DEPLOYED_OWNER = 0xeC68c705001a158d0f810182Ca205887679E33f5;
    uint8 internal constant USDC_DECIMALS = 6;
    uint256 internal constant DEPLOYED_DISCOUNT_BPS = 100;

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroAddress(string field);
    error AddressHasNoCode(string field, address account);
    error UnexpectedAddress(string field, address actual, address expected);
    error UnexpectedUint(string field, uint256 actual, uint256 expected);
    error UnexpectedBool(string field, bool actual, bool expected);
    error AddressNotChecksummed(string field, string actual, string expected);
    error AccountingInvariantFailed(string invariantName);

    function run() external view {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }

        address managerAddress =
            _readChecksummedDeploymentAddress("MandateManager", "MANDATE_MANAGER_ADDRESS", DEPLOYED_MANAGER);
        address vaultAddress =
            _readChecksummedDeploymentAddress("AdvanceVault", "ADVANCE_VAULT_ADDRESS", DEPLOYED_VAULT);
        address configuredUsdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        address expectedOwner = vm.envOr("EXPECTED_OWNER", DEPLOYED_OWNER);
        uint256 expectedDiscountBps = vm.envOr("ADVANCE_DISCOUNT_BPS", DEPLOYED_DISCOUNT_BPS);
        bool expectedFrozen = vm.envOr("FREEZE_AUTHORIZED_VAULT", false);

        _requireContract("MandateManager", managerAddress);
        _requireContract("AdvanceVault", vaultAddress);
        _requireContract("USDC", configuredUsdc);
        _expectAddress("deployed MandateManager", managerAddress, DEPLOYED_MANAGER);
        _expectAddress("deployed AdvanceVault", vaultAddress, DEPLOYED_VAULT);
        _expectAddress("canonical USDC", configuredUsdc, ARC_USDC);
        _expectAddress("deployment owner", expectedOwner, DEPLOYED_OWNER);
        _expectUint("deployment discount bps", expectedDiscountBps, DEPLOYED_DISCOUNT_BPS);
        _expectBool("deployment frozen expectation", expectedFrozen, false);

        MandateManager manager = MandateManager(managerAddress);
        AdvanceVault vault = AdvanceVault(vaultAddress);

        address managerOwner = manager.owner();
        address vaultOwner = vault.owner();

        _expectAddress("MandateManager owner", managerOwner, expectedOwner);
        _expectAddress("AdvanceVault owner", vaultOwner, expectedOwner);
        _expectAddress("AdvanceVault owner", vaultOwner, managerOwner);
        _expectAddress("MandateManager USDC", address(manager.usdc()), configuredUsdc);
        _expectAddress("AdvanceVault USDC", address(vault.usdc()), configuredUsdc);
        _expectAddress("AdvanceVault manager", address(vault.mandateManager()), managerAddress);
        _expectAddress("authorized AdvanceVault", manager.authorizedAdvanceVault(), vaultAddress);
        _expectUint("USDC decimals", IERC20Metadata(configuredUsdc).decimals(), USDC_DECIMALS);
        _expectUint("discount bps", vault.discountBps(), expectedDiscountBps);
        _expectBool("authorized vault frozen", manager.authorizedVaultFrozen(), expectedFrozen);

        AdvanceVault.VaultStats memory stats = vault.poolStats();
        uint256 availableLiquidity = vault.availableLiquidity();
        uint256 actualUsdcBalance = IERC20Metadata(configuredUsdc).balanceOf(vaultAddress);

        _expectUint("pool liquidity deposited", stats.liquidityDeposited, vault.totalLiquidityDeposited());
        _expectUint("pool advanced", stats.advanced, vault.totalAdvanced());
        _expectUint("pool face value", stats.faceValueAcquired, vault.totalFaceValueAcquired());
        _expectUint("pool expected spread", stats.expectedSpread, vault.totalExpectedSpread());
        _expectUint("pool repayments", stats.repaymentsRecognized, vault.totalRepaymentsRecognized());
        _expectUint("pool realized spread", stats.realizedSpread, vault.totalRealizedSpread());
        _expectUint("pool available liquidity", stats.liquidityAvailable, availableLiquidity);

        if (stats.faceValueAcquired < stats.advanced) {
            revert AccountingInvariantFailed("face value must cover advances");
        }
        _expectUint("cumulative expected spread", stats.expectedSpread, stats.faceValueAcquired - stats.advanced);
        if (stats.repaymentsRecognized > stats.faceValueAcquired) {
            revert AccountingInvariantFailed("repayments cannot exceed acquired face value");
        }
        if (stats.realizedSpread > stats.expectedSpread) {
            revert AccountingInvariantFailed("realized spread cannot exceed expected spread");
        }
        if (stats.liquidityDeposited + stats.repaymentsRecognized < stats.advanced) {
            revert AccountingInvariantFailed("accounted liquidity cannot be negative");
        }
        _expectUint(
            "accounted available liquidity",
            availableLiquidity,
            stats.liquidityDeposited + stats.repaymentsRecognized - stats.advanced
        );
        if (actualUsdcBalance < availableLiquidity) {
            revert AccountingInvariantFailed("available liquidity exceeds ERC-20 balance");
        }

        console2.log("Fidra Arc Testnet deployment verified");
        console2.log("Chain ID:", block.chainid);
        console2.log("MandateManager:", managerAddress);
        console2.log("MandateManager owner:", managerOwner);
        console2.log("AdvanceVault:", vaultAddress);
        console2.log("AdvanceVault owner:", vaultOwner);
        console2.log("ERC-20 USDC:", configuredUsdc);
        console2.log("USDC decimals:", IERC20Metadata(configuredUsdc).decimals());
        console2.log("Authorized vault:", manager.authorizedAdvanceVault());
        console2.log("Authorized vault frozen:", manager.authorizedVaultFrozen());
        console2.log("Advance discount (bps):", vault.discountBps());
        console2.log("Vault ERC-20 USDC balance (6-decimal units):", actualUsdcBalance);
        console2.log("Liquidity deposited (6-decimal units):", stats.liquidityDeposited);
        console2.log("Total advanced (6-decimal units):", stats.advanced);
        console2.log("Face value acquired (6-decimal units):", stats.faceValueAcquired);
        console2.log("Expected spread (6-decimal units):", stats.expectedSpread);
        console2.log("Repayments recognized (6-decimal units):", stats.repaymentsRecognized);
        console2.log("Realized spread (6-decimal units):", stats.realizedSpread);
        console2.log("Available vault liquidity (6-decimal units):", availableLiquidity);
    }

    function _readChecksummedDeploymentAddress(string memory field, string memory envKey, address expected)
        internal
        view
        returns (address account)
    {
        string memory raw = vm.envOr(envKey, vm.toString(expected));
        account = vm.parseAddress(raw);
        string memory checksummed = vm.toString(account);
        if (keccak256(bytes(raw)) != keccak256(bytes(checksummed))) {
            revert AddressNotChecksummed(field, raw, checksummed);
        }
    }

    function _requireContract(string memory field, address account) internal view {
        if (account == address(0)) revert ZeroAddress(field);
        if (account.code.length == 0) revert AddressHasNoCode(field, account);
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
