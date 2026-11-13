import type { AttentionRecord, AttentionState } from "./attentionTypes.js";
import { hasUncertainAttention } from "./attentionTypes.js";

const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
function instant(value: unknown) {
  if (!text(value) || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new Error("invalid_time");
}

/** An exact revision and evidence reference protect concurrent sender/custody updates. */
export function applyAttentionChange(record: AttentionRecord, input: Record<string, unknown>): AttentionState {
  if (input.revision !== record.revision || !text(input.reference)) throw new Error("revision_or_reference_required");
  const state = structuredClone(record.state);
  if (input.action === "facts") {
    const facts = input.facts as Record<string, unknown>;
    const allowed = ["pickupKnown", "pickup", "failureKind", "reason", "affectedSystems", "endedBy", "endedOnItsOwn"];
    if (
      !facts ||
      typeof facts !== "object" ||
      Array.isArray(facts) ||
      Object.keys(facts).some((key) => !allowed.includes(key))
    )
      throw new Error("invalid_facts");
    if (facts.pickupKnown !== undefined && typeof facts.pickupKnown !== "boolean") throw new Error("invalid_pickup");
    if (facts.pickup) {
      const pickup = facts.pickup as Record<string, unknown>;
      if (![pickup.who, pickup.session].every(text) || typeof pickup.current !== "boolean")
        throw new Error("invalid_pickup");
      instant(pickup.since);
    }
    if (facts.pickup !== undefined && facts.pickup !== null && typeof facts.pickup !== "object")
      throw new Error("invalid_pickup");
    for (const key of ["failureKind", "reason", "endedBy"] as const)
      if (facts[key] !== undefined && facts[key] !== null && !text(facts[key])) throw new Error("invalid_fact");
    if (
      facts.affectedSystems !== undefined &&
      (!Array.isArray(facts.affectedSystems) || !facts.affectedSystems.every(text))
    )
      throw new Error("invalid_impact");
    if (facts.endedOnItsOwn !== undefined && typeof facts.endedOnItsOwn !== "boolean")
      throw new Error("invalid_recovery");
    const corrected = { ...state.facts };
    // A changed classification must not inherit the old classification's prose.
    if ("failureKind" in facts && facts.failureKind !== corrected.failureKind && !("reason" in facts))
      delete corrected.reason;
    for (const [key, value] of Object.entries(facts)) {
      if (value === null && key !== "pickup") delete corrected[key as keyof typeof corrected];
      else Object.assign(corrected, { [key]: value });
    }
    if (
      (corrected.pickup && corrected.pickupKnown === false) ||
      (corrected.endedBy && corrected.endedOnItsOwn === true)
    )
      throw new Error("contradictory_facts");
    state.facts = corrected;
    state.factsReference = input.reference as string;
  } else if (input.action === "reconcile") {
    const message = state.messages.find((item) => item.attempt === input.attempt);
    if (
      !message ||
      !["sending", "unknown", "accepted", "failed"].includes(message.outcome) ||
      !["sent", "failed"].includes(String(input.outcome))
    )
      throw new Error("invalid_reconciliation");
    // Operator proof is explicit, not inferred from HTTP 2xx or queue completion.
    message.outcome = input.outcome as "sent" | "failed";
    message.boundary = "operator";
    message.reference = input.reference as string;
    if (message.outcome === "sent") {
      instant(input.at);
      message.at = input.at as string;
    }
  } else if (input.action === "retry") {
    if (!state.retry || hasUncertainAttention(state.messages)) throw new Error("retry_requires_known_no_effect");
    // An attributable operator correction can rearm delivery; receipts survive.
    delete state.retry;
    state.retryReference = input.reference as string;
  } else throw new Error("invalid_action");
  return state;
}
