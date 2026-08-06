export const DEMO_STATES = Object.freeze([
  "wallet_ready", "gas_ready", "task_complete", "claim_created", "claim_certified",
  "awaiting_approval", "arc_pending", "advance_confirmed", "complete",
]);

export function demoWorkflowFlags(workflow) {
  const state = workflow?.state ?? "not_started";
  const index = DEMO_STATES.indexOf(state);
  return {
    state,
    gasReady: index >= DEMO_STATES.indexOf("gas_ready"),
    claimReady: Boolean(workflow?.claim?.certifyReceipt),
    approvalPending: ["awaiting_approval", "arc_pending"].includes(state),
    advanceReady: Boolean(workflow?.advance?.receipt),
    settlementPending: state === "advance_confirmed",
    complete: state === "complete" && Boolean(workflow?.settlement?.receipt),
  };
}

export function demoRecoveryAction(workflow) {
  const flags = demoWorkflowFlags(workflow);
  if (flags.state === "arc_pending" && workflow.advance?.operationId) return "poll_advance";
  if (flags.settlementPending && workflow.advance?.receipt) return "settle";
  return null;
}
