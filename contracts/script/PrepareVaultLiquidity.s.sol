// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {AdvanceVault} from "../src/AdvanceVault.sol";

/// @notice Read-only readiness checks for a deliberately small Arc demo-vault deposit.
/// @dev Arc USDC calls protocol system contracts that Forge's local EVM may not model. This script
///      intentionally does not broadcast; use the documented `cast send` transactions through Arc RPC.
contract PrepareVaultLiquidity is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant DEPLOYED_MANAGER = 0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2;
    address internal constant DEPLOYED_VAULT = 0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B;
    address internal constant DEPLOYED_OWNER = 0xeC68c705001a158d0f810182Ca205887679E33f5;
    uint256 internal constant MAX_DEMO_LIQUIDITY = 20_000_000;

    error WrongChain(uint256 actual, uint256 expected);
    error InvalidConfiguration();
    error InvalidLiquidityAmount(uint256 amount);
    error InsufficientErc20Usdc(uint256 required, uint256 available);
    error NoNativeGasUsdc(address actor);

    function run() external view {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }

        uint256 amount = vm.envUint("DEMO_LIQUIDITY_AMOUNT");
        address actor = vm.envOr("SMOKE_ACTOR_ADDRESS", DEPLOYED_OWNER);
        if (amount == 0 || amount > MAX_DEMO_LIQUIDITY) revert InvalidLiquidityAmount(amount);

        IERC20 usdc = IERC20(ARC_USDC);
        MandateManager manager = MandateManager(DEPLOYED_MANAGER);
        AdvanceVault vault = AdvanceVault(DEPLOYED_VAULT);

        if (
            actor != DEPLOYED_OWNER || manager.owner() != actor || vault.owner() != actor
                || address(manager.usdc()) != ARC_USDC || address(vault.usdc()) != ARC_USDC
                || address(vault.mandateManager()) != DEPLOYED_MANAGER
                || manager.authorizedAdvanceVault() != DEPLOYED_VAULT || manager.authorizedVaultFrozen()
                || vault.discountBps() != 100
        ) {
            revert InvalidConfiguration();
        }

        uint256 ownerBalance = usdc.balanceOf(actor);
        if (ownerBalance < amount) revert InsufficientErc20Usdc(amount, ownerBalance);
        if (actor.balance == 0) revert NoNativeGasUsdc(actor);

        uint256 availableBefore = vault.availableLiquidity();
        uint256 depositedBefore = vault.totalLiquidityDeposited();
        uint256 currentAllowance = usdc.allowance(actor, DEPLOYED_VAULT);

        console2.log("Arc ERC-20 USDC vault-liquidity preflight");
        console2.log("Owner:", actor);
        console2.log("AdvanceVault:", DEPLOYED_VAULT);
        console2.log("Deposit amount (6-decimal units):", amount);
        console2.log("Owner ERC-20 USDC balance (6-decimal units):", ownerBalance);
        console2.log("Owner native gas balance (RPC-native units):", actor.balance);
        console2.log("Current vault allowance (6-decimal units):", currentAllowance);
        console2.log("Available before (6-decimal units):", availableBefore);
        console2.log("Total deposited before (6-decimal units):", depositedBefore);
        console2.log("Preflight passed: no transaction was signed or broadcast");
        console2.log("Next: approve and deposit with the documented direct Arc RPC cast commands");
    }
}
