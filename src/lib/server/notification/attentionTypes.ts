export interface AttentionReceipt {
  attempt: string;
  event: string;
  at: string;
  outcome: "sending" | "sent" | "accepted" | "unknown" | "failed";
  standing?: string;
  affectedSystems?: string[];
  boundary?: "telegram-message" | "telegram-rejection" | "http" | "operator";
  reference?: string;
  retryAfterSeconds?: number;
}
export interface AttentionFacts {
  pickupKnown?: boolean;
  pickup?: { who: string; since: string; session: string; current: boolean } | null;
  failureKind?: string;
  reason?: string;
  affectedSystems?: string[];
  endedBy?: string;
  endedOnItsOwn?: boolean;
}
export interface AttentionState {
  facts: AttentionFacts;
  factsReference?: string;
  messages: AttentionReceipt[];
  retry?: { key: string; attempts: number; nextAt: string | null; exhausted: boolean };
  retryReference?: string;
}
export interface AttentionRecord {
  revision: number;
  state: AttentionState;
}

/** Older HTTP-only failures did not establish no effect and cannot authorize retry. */
export function hasUncertainAttention(messages: AttentionReceipt[]): boolean {
  return messages.some(
    (item) =>
      ["sending", "unknown", "accepted"].includes(item.outcome) ||
      (item.outcome === "failed" && !["telegram-rejection", "operator"].includes(item.boundary ?? "")),
  );
}
export interface AttentionComposition {
  text: string;
  row: { systemId: string };
  notification: { event: string | null; standing?: string; next: string };
}
