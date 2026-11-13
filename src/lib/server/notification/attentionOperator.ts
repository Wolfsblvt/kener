import type { AttentionRecord, AttentionState } from "./attentionTypes.js";

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
    const facts = input.facts as AttentionState["facts"];
    const allowed = ["pickupKnown", "pickup", "failureKind", "reason", "affectedSystems", "endedBy", "endedOnItsOwn"];
    if (!facts || Object.keys(facts).some((key) => !allowed.includes(key))) throw new Error("invalid_facts");
    if (facts.pickupKnown !== undefined && typeof facts.pickupKnown !== "boolean") throw new Error("invalid_pickup");
    if (facts.pickup) {
      if (![facts.pickup.who, facts.pickup.session].every(text) || typeof facts.pickup.current !== "boolean")
        throw new Error("invalid_pickup");
      instant(facts.pickup.since);
    }
    for (const key of ["failureKind", "reason", "endedBy"] as const)
      if (facts[key] !== undefined && !text(facts[key])) throw new Error("invalid_fact");
    if (
      facts.affectedSystems !== undefined &&
      (!Array.isArray(facts.affectedSystems) || !facts.affectedSystems.every(text))
    )
      throw new Error("invalid_impact");
    if (facts.endedOnItsOwn !== undefined && typeof facts.endedOnItsOwn !== "boolean")
      throw new Error("invalid_recovery");
    state.facts = { ...state.facts, ...facts };
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
  } else throw new Error("invalid_action");
  return state;
}
