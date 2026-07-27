// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {AdvanceVault} from "../src/AdvanceVault.sol";

/// @notice Deploys and configures the Fidra MVP contracts on Arc Testnet.
/// @dev The broadcaster comes from Forge CLI wallet options. This script never reads a private key.
contract DeployFidra is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint8 internal constant USDC_DECIMALS = 6;
    uint256 internal constant MAX_DISCOUNT_BPS = 3_000;

    error WrongChain(uint256 actual, uint256 expected);
    error NonCanonicalUsdc(address actual, address expected);
    error UsdcHasNoCode(address usdc);
    error WrongUsdcDecimals(uint8 actual, uint8 expected);
    error InvalidDiscountBps(uint256 discountBps);
    error DeploymentInvariantFailed();

    function run() external returns (MandateManager manager, AdvanceVault vault) {
        _requireArcTestnet();

        address usdcAddress = vm.envOr("USDC_ADDRESS", ARC_USDC);
        uint256 discountBps = vm.envUint("ADVANCE_DISCOUNT_BPS");
        bool freezeAuthorizedVault = vm.envOr("FREEZE_AUTHORIZED_VAULT", false);

        _validateUsdc(usdcAddress);
        if (discountBps == 0 || discountBps > MAX_DISCOUNT_BPS) {
            revert InvalidDiscountBps(discountBps);
        }

        console2.log("Fidra Arc Testnet deployment");
        console2.log("Chain ID:", block.chainid);
        console2.log("ERC-20 USDC:", usdcAddress);
        console2.log("USDC decimals:", USDC_DECIMALS);
        console2.log("Advance discount (bps):", discountBps);
        console2.log("Freeze authorized vault:", freezeAuthorizedVault);

        vm.startBroadcast();

        manager = new MandateManager(IERC20(usdcAddress));
        vault = new AdvanceVault(usdcAddress, address(manager), discountBps);
        manager.setAuthorizedAdvanceVault(address(vault));

        if (freezeAuthorizedVault) {
            manager.freezeAuthorizedAdvanceVault();
        }

        vm.stopBroadcast();

        if (
            address(manager.usdc()) != usdcAddress || address(vault.usdc()) != usdcAddress
                || address(vault.mandateManager()) != address(manager)
                || manager.authorizedAdvanceVault() != address(vault)
                || manager.authorizedVaultFrozen() != freezeAuthorizedVault || manager.owner() == address(0)
                || vault.owner() != manager.owner() || vault.discountBps() != discountBps
        ) {
            revert DeploymentInvariantFailed();
        }

        console2.log("MandateManager:", address(manager));
        console2.log("AdvanceVault:", address(vault));
        console2.log("Owner:", manager.owner());
        console2.log("Authorized vault:", manager.authorizedAdvanceVault());
        console2.log("Authorized vault frozen:", manager.authorizedVaultFrozen());
        console2.log("ArcScan manager:");
        console2.log(string.concat("https://testnet.arcscan.app/address/", vm.toString(address(manager))));
        console2.log("ArcScan vault:");
        console2.log(string.concat("https://testnet.arcscan.app/address/", vm.toString(address(vault))));
    }

    function _requireArcTestnet() internal view {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }
    }

    function _validateUsdc(address usdcAddress) internal view {
        if (usdcAddress != ARC_USDC) revert NonCanonicalUsdc(usdcAddress, ARC_USDC);
        if (usdcAddress.code.length == 0) revert UsdcHasNoCode(usdcAddress);

        uint8 actualDecimals = IERC20Metadata(usdcAddress).decimals();
        if (actualDecimals != USDC_DECIMALS) {
            revert WrongUsdcDecimals(actualDecimals, USDC_DECIMALS);
        }
    }
}
