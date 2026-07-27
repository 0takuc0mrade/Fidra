// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MandateManager} from "../src/MandateManager.sol";
import {AdvanceVault} from "../src/AdvanceVault.sol";

/// @notice Read-only readiness checks for a tiny, single-actor Arc smoke flow.
/// @dev Arc USDC calls protocol system contracts that Forge's local EVM may not model. This script
///      intentionally does not broadcast; execute each documented `cast send` through Arc RPC.
contract SmokeFidra is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    address internal constant DEPLOYED_MANAGER = 0xEfA2b3e70138810eA51552177c3f1AE5ab249EF2;
    address internal constant DEPLOYED_VAULT = 0x5F7Bec9eC341F816182a56D8E033cac63DBd8C8B;
    address internal constant DEPLOYED_OWNER = 0xeC68c705001a158d0f810182Ca205887679E33f5;
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    uint256 internal constant DEPLOYED_DISCOUNT_BPS = 100;
    uint256 internal constant MAX_SMOKE_FACE_AMOUNT = 10_000_000;

    struct SmokeConfig {
        address actor;
        uint256 faceAmount;
        uint256 advanceAmount;
        uint256 spread;
        uint256 runId;
        bytes32 externalRefHash;
        bytes32 proofHash;
        bytes32 metadataHash;
    }

    error WrongChain(uint256 actual, uint256 expected);
    error InvalidConfiguration();
    error InvalidSmokeAmount(uint256 amount);
    error InvalidRunId();
    error InsufficientErc20Usdc(uint256 required, uint256 available);
    error NoNativeGasUsdc(address actor);
    error InsufficientVaultLiquidity(uint256 required, uint256 available);

    function run() external view {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }

        SmokeConfig memory config;
        config.actor = vm.envOr("SMOKE_ACTOR_ADDRESS", DEPLOYED_OWNER);
        config.faceAmount = vm.envUint("SMOKE_FACE_AMOUNT");
        config.runId = vm.envUint("SMOKE_RUN_ID");
        if (config.faceAmount == 0 || config.faceAmount > MAX_SMOKE_FACE_AMOUNT) {
            revert InvalidSmokeAmount(config.faceAmount);
        }
        if (config.runId == 0) revert InvalidRunId();

        IERC20 usdc = IERC20(ARC_USDC);
        MandateManager manager = MandateManager(DEPLOYED_MANAGER);
        AdvanceVault vault = AdvanceVault(DEPLOYED_VAULT);
        _validateConfiguration(config.actor, manager, vault);

        config.advanceAmount = Math.mulDiv(config.faceAmount, BPS_DENOMINATOR - DEPLOYED_DISCOUNT_BPS, BPS_DENOMINATOR);
        config.spread = config.faceAmount - config.advanceAmount;
        if (config.advanceAmount == 0 || config.spread == 0) revert InvalidSmokeAmount(config.faceAmount);

        uint256 actorBalance = usdc.balanceOf(config.actor);
        if (actorBalance < config.faceAmount) revert InsufficientErc20Usdc(config.faceAmount, actorBalance);
        if (config.actor.balance == 0) revert NoNativeGasUsdc(config.actor);

        AdvanceVault.VaultStats memory statsBefore = vault.poolStats();
        if (statsBefore.liquidityAvailable < config.advanceAmount) {
            revert InsufficientVaultLiquidity(config.advanceAmount, statsBefore.liquidityAvailable);
        }

        config.externalRefHash = keccak256(abi.encode("FIDRA_ARC_SMOKE_REF", config.actor, config.runId));
        config.proofHash = keccak256(abi.encode("FIDRA_ARC_SMOKE_PROOF", config.actor, config.runId));
        config.metadataHash = keccak256(abi.encode("FIDRA_ARC_SMOKE_MANDATE", config.actor, config.runId));

        console2.log("Starting tiny Fidra Arc smoke flow");
        console2.log("Actor (business/agent/approver/vendor):", config.actor);
        console2.log("Face amount (6-decimal units):", config.faceAmount);
        console2.log("Minimum advance (6-decimal units):", config.advanceAmount);
        console2.log("Expected spread (6-decimal units):", config.spread);
        console2.log("Run ID:", config.runId);
        console2.log("proofHash is an audit reference, not delivery verification");
        console2.log("Current manager allowance (6-decimal units):", usdc.allowance(config.actor, DEPLOYED_MANAGER));
        console2.log("Available vault liquidity (6-decimal units):", statsBefore.liquidityAvailable);
        console2.log("Suggested mandate expiry:", block.timestamp + 1 days);
        console2.log("Suggested claim quote deadline:", block.timestamp + 15 minutes);
        console2.log("External reference hash:");
        console2.logBytes32(config.externalRefHash);
        console2.log("Proof hash:");
        console2.logBytes32(config.proofHash);
        console2.log("Metadata hash:");
        console2.logBytes32(config.metadataHash);
        console2.log("Read-only smoke readiness passed: no transaction was signed or broadcast");
        console2.log("Execute the documented cast sequence and capture real IDs and transaction hashes");
    }

    function _validateConfiguration(address actor, MandateManager manager, AdvanceVault vault) internal view {
        if (
            actor != DEPLOYED_OWNER || manager.owner() != actor || vault.owner() != actor
                || address(manager.usdc()) != ARC_USDC || address(vault.usdc()) != ARC_USDC
                || address(vault.mandateManager()) != DEPLOYED_MANAGER
                || manager.authorizedAdvanceVault() != DEPLOYED_VAULT || manager.authorizedVaultFrozen()
                || vault.discountBps() != DEPLOYED_DISCOUNT_BPS
        ) {
            revert InvalidConfiguration();
        }
    }
}
