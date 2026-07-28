// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {PlatformRegistry} from "../src/PlatformRegistry.sol";
import {EarningsManager} from "../src/EarningsManager.sol";
import {AdvanceVaultV2} from "../src/AdvanceVaultV2.sol";

/// @notice Writes confirmed Foundry broadcast data to the V1.1-specific Arc Testnet artifact.
/// @dev Run only after deployment receipts are confirmed. It never broadcasts.
contract RecordFidraV11Deployment is Script {
    uint64 internal constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    string internal constant EXPLORER = "https://testnet.arcscan.app";

    error WrongChain(uint256 actual, uint256 expected);
    error UnconfirmedDeployment(string contractName);
    error UnexpectedDeploymentAddress(string contractName, address actual, address expected);

    function run() external {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);
        }

        address registryAddress = vm.envAddress("V1_PLATFORM_REGISTRY_ADDRESS");
        address earningsAddress = vm.envAddress("V1_EARNINGS_MANAGER_ADDRESS");
        address vaultAddress = vm.envAddress("V1_ADVANCE_VAULT_ADDRESS");

        VmSafe.BroadcastTxSummary memory registryTx =
            vm.getBroadcast("PlatformRegistry", ARC_TESTNET_CHAIN_ID, VmSafe.BroadcastTxType.Create);
        VmSafe.BroadcastTxSummary memory earningsTx =
            vm.getBroadcast("EarningsManager", ARC_TESTNET_CHAIN_ID, VmSafe.BroadcastTxType.Create);
        VmSafe.BroadcastTxSummary memory vaultTx =
            vm.getBroadcast("AdvanceVaultV2", ARC_TESTNET_CHAIN_ID, VmSafe.BroadcastTxType.Create);

        _validateDeployment("PlatformRegistry", registryTx, registryAddress);
        _validateDeployment("EarningsManager", earningsTx, earningsAddress);
        _validateDeployment("AdvanceVaultV2", vaultTx, vaultAddress);

        VmSafe.BroadcastTxSummary[] memory registryCalls =
            vm.getBroadcasts("PlatformRegistry", ARC_TESTNET_CHAIN_ID, VmSafe.BroadcastTxType.Call);
        VmSafe.BroadcastTxSummary[] memory earningsCalls =
            vm.getBroadcasts("EarningsManager", ARC_TESTNET_CHAIN_ID, VmSafe.BroadcastTxType.Call);

        string memory registryJson = _serializeContract("registry", registryTx);
        string memory earningsJson = _serializeContract("earnings", earningsTx);
        string memory vaultJson = _serializeContract("vault", vaultTx);

        string memory root = "fidraV11";
        vm.serializeString(root, "network", "arc-testnet");
        vm.serializeUint(root, "chainId", ARC_TESTNET_CHAIN_ID);
        vm.serializeString(root, "gitCommit", vm.envString("V1_GIT_COMMIT"));
        vm.serializeString(root, "explorer", EXPLORER);
        vm.serializeAddress(root, "usdc", vm.envAddress("USDC_ADDRESS"));
        vm.serializeAddress(root, "owner", vm.envAddress("V1_OWNER_ADDRESS"));
        vm.serializeAddress(root, "platformSettlementWallet", vm.envAddress("PLATFORM_SETTLEMENT_WALLET"));
        vm.serializeAddress(root, "workerWallet", vm.envAddress("WORKER_WALLET"));
        vm.serializeUint(root, "platformId", vm.envUint("V1_PLATFORM_ID"));
        vm.serializeUint(root, "creditLimit", vm.envUint("V1_CREDIT_LIMIT"));
        vm.serializeUint(root, "advanceFeeBps", vm.envUint("V1_ADVANCE_FEE_BPS"));
        vm.serializeString(root, "status", "deployed-unverified");
        vm.serializeString(root, "PlatformRegistry", registryJson);
        vm.serializeString(root, "EarningsManager", earningsJson);
        vm.serializeString(root, "AdvanceVaultV2", vaultJson);
        vm.serializeBytes32(root, "registryCallTransactionHashes", _hashes(registryCalls));
        string memory json = vm.serializeBytes32(root, "earningsCallTransactionHashes", _hashes(earningsCalls));

        vm.writeJson(json, vm.envString("V1_DEPLOYMENT_ARTIFACT"));
    }

    function _serializeContract(string memory objectKey, VmSafe.BroadcastTxSummary memory summary)
        internal
        returns (string memory json)
    {
        vm.serializeAddress(objectKey, "address", summary.contractAddress);
        vm.serializeBytes32(objectKey, "deploymentTransactionHash", summary.txHash);
        vm.serializeUint(objectKey, "deploymentBlock", summary.blockNumber);
        vm.serializeBool(objectKey, "transactionSucceeded", summary.success);
        vm.serializeBool(objectKey, "sourceVerified", false);
        vm.serializeString(
            objectKey, "explorerUrl", string.concat(EXPLORER, "/address/", vm.toString(summary.contractAddress))
        );
        json = vm.serializeString(
            objectKey, "transactionExplorerUrl", string.concat(EXPLORER, "/tx/", vm.toString(summary.txHash))
        );
    }

    function _validateDeployment(string memory contractName, VmSafe.BroadcastTxSummary memory summary, address expected)
        internal
        pure
    {
        if (!summary.success || summary.txHash == bytes32(0)) {
            revert UnconfirmedDeployment(contractName);
        }
        if (summary.contractAddress != expected) {
            revert UnexpectedDeploymentAddress(contractName, summary.contractAddress, expected);
        }
    }

    function _hashes(VmSafe.BroadcastTxSummary[] memory summaries) internal pure returns (bytes32[] memory hashes) {
        hashes = new bytes32[](summaries.length);
        for (uint256 i; i < summaries.length; ++i) {
            if (!summaries[i].success || summaries[i].txHash == bytes32(0)) {
                revert UnconfirmedDeployment("configuration call");
            }
            hashes[i] = summaries[i].txHash;
        }
    }
}
