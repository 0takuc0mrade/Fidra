export const CIRCLE_WORKER_WALLET_KEY = "fidra-circle-worker-wallet";

export function saveCircleWorkerWallet(wallet) {
  if (!wallet?.address || wallet.accountType !== "EOA" || wallet.blockchain !== "ARC-TESTNET") return;
  window.localStorage.setItem(CIRCLE_WORKER_WALLET_KEY, JSON.stringify({
    id: wallet.id,
    address: wallet.address,
    accountType: wallet.accountType,
    blockchain: wallet.blockchain,
  }));
}

export function clearCircleWorkerWallet() {
  window.localStorage.removeItem(CIRCLE_WORKER_WALLET_KEY);
}
