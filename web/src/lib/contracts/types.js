import { formatUnits, parseUnits } from "viem";
import {
  MANDATE_STATUS_LABELS,
  REQUEST_STATUS_LABELS,
  EARNINGS_CLAIM_STATUS_LABELS,
  PURCHASE_STATUS_LABELS,
} from "../../../../shared/types.js";
import { USDC_DECIMALS } from "../../../../shared/constants.js";

export function asBigInt(value, fallback = 0n) {
  try {
    return typeof value === "bigint" ? value : BigInt(value ?? fallback);
  } catch {
    return fallback;
  }
}

export function formatUsdc(value, options = {}) {
  const { minimumFractionDigits = 2, maximumFractionDigits = 6 } = options;
  const [whole, rawFraction = ""] = formatUnits(asBigInt(value), USDC_DECIMALS).split(".");
  let fraction = rawFraction.slice(0, maximumFractionDigits);
  while (fraction.length > minimumFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  fraction = fraction.padEnd(minimumFractionDigits, "0");
  const groupedWhole = BigInt(whole).toLocaleString("en-US");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

export function parseUsdc(value) {
  return parseUnits(String(value), USDC_DECIMALS);
}

export function formatBpsPercent(value) {
  const bps = asBigInt(value);
  const whole = bps / 100n;
  const fraction = bps % 100n;
  if (fraction === 0n) return `${whole}%`;
  return `${whole}.${fraction.toString().padStart(2, "0").replace(/0+$/, "")}%`;
}

export function usdcUnitsToNumber(value) {
  return Number(formatUnits(asBigInt(value), USDC_DECIMALS));
}

export function mandateStatusLabel(value, expiresAt) {
  const numeric = Number(value);
  if (numeric === 1 && asBigInt(expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) return "Expired";
  return MANDATE_STATUS_LABELS[numeric] ?? "Unknown";
}

export function requestStatusLabel(value) {
  return REQUEST_STATUS_LABELS[Number(value)] ?? "Unknown";
}

export function earningsClaimStatusLabel(value) {
  return EARNINGS_CLAIM_STATUS_LABELS[Number(value)] ?? "Unknown";
}

export function purchaseStatusLabel(value) {
  return PURCHASE_STATUS_LABELS[Number(value)] ?? "Unknown";
}

export function formatTimestamp(value, fallback = "Not set") {
  const seconds = asBigInt(value);
  if (seconds === 0n) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Number(seconds) * 1000));
}

export function truncateHex(value, leading = 6, trailing = 4) {
  if (!value || value.length <= leading + trailing + 1) return value || "—";
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
}
