export interface AttentionReceipt {
  attempt: string;
  event: string;
  at: string;
  outcome: "sending" | "sent" | "accepted" | "unknown" | "failed";
  standing?: string;
  affectedSystems?: string[];
  boundary?: "telegram-message" | "http" | "operator";
  reference?: string;
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
}
export interface AttentionRecord {
  revision: number;
  state: AttentionState;
}
export interface AttentionComposition {
  text: string;
  row: { systemId: string };
  notification: { event: string | null; standing?: string; next: string };
}
