export const initialClaims = [
  {
    id: 205,
    vendor: "Northwind Components",
    amount: 850,
    state: "Approved",
    detail: "Reversible · not reserved",
    submitted: "7m ago",
    action: "Lock claim",
    tab: "needs-action",
  },
  {
    id: 206,
    vendor: "Atlas Supply",
    amount: 420,
    state: "Requested",
    detail: "Awaiting review",
    submitted: "3m ago",
    action: "Review request",
    tab: "needs-action",
  },
  {
    id: 204,
    vendor: "Atlas Supply",
    amount: 1000,
    state: "Locked",
    detail: "Irrevocable · fully reserved",
    submitted: "12m ago",
    action: "Release payment",
    tab: "locked",
  },
  {
    id: 201,
    vendor: "Meridian Freight",
    amount: 600,
    state: "Released",
    detail: "Settled to vendor",
    submitted: "Jun 28",
    action: null,
  },
  {
    id: 199,
    vendor: "Cedar Office",
    amount: 250,
    state: "Rejected",
    detail: "Closed before lock",
    submitted: "Jun 26",
    action: null,
  },
];

export const policy = [
  ["Expiry", "Sep 30 2026"],
  ["Maximum purchase", "1,250.00 USDC"],
  ["Proof commitment", "Required"],
  ["Allowed vendors", "3 allowlisted"],
];

export const identities = [
  ["Agent", "ProcureBot", "0xA91E…42D7"],
  ["Approver", "Maya Chen", "0x5B60…9C18"],
  ["Owner", "Northstar Labs", "0x71C4…9A20"],
];
