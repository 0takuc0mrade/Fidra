export const VENDOR_MODE_KEY = "fidra-vendor-identity-mode";
export const CIRCLE_VENDOR_WALLET_KEY = "fidra-circle-vendor-wallet";

export function loadVendorMode() {
  return window.localStorage.getItem(VENDOR_MODE_KEY) === "circle" ? "circle" : "metamask";
}

export function saveVendorMode(mode) {
  window.localStorage.setItem(VENDOR_MODE_KEY, mode === "circle" ? "circle" : "metamask");
}

export function saveCircleVendorWallet(wallet) {
  if (!wallet?.address || wallet.accountType !== "EOA" || wallet.blockchain !== "ARC-TESTNET") return;
  window.localStorage.setItem(CIRCLE_VENDOR_WALLET_KEY, JSON.stringify({
    id: wallet.id,
    address: wallet.address,
    accountType: wallet.accountType,
    blockchain: wallet.blockchain,
  }));
}

export function clearCircleVendorWallet() {
  window.localStorage.removeItem(CIRCLE_VENDOR_WALLET_KEY);
  saveVendorMode("metamask");
}
