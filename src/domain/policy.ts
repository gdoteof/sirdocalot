// What "done collecting" means for one brief.
//
// A field on the brief rather than an architectural choice: all four shapes are
// legitimate and the service just enforces whichever the agent named. Evaluation
// takes `now` as an argument -- reading a clock in here would make the domain
// depend on an ambient capability, and would make the deadline case untestable
// without waiting for real time to pass.

import type { ParticipantId } from "./ids.ts";

export type CloseWhen =
  | { kind: "all" }
  | { kind: "quorum"; n: number }
  | { kind: "deadline"; at: string }
  | { kind: "manual" };

export type Visibility = "blind" | "open";

export type CollectionPolicy = {
  closeWhen: CloseWhen;
  // Blind is a survey; open is a deliberation. They produce genuinely different
  // answers, so it is stated per brief rather than chosen once for the service.
  visibility: Visibility;
};

export type CloseReason =
  | "all-responded"
  | "quorum-reached"
  | "deadline-passed"
  | "closed-manually"
  | "no-input-requested";

export type Closure = { closed: boolean; reason?: CloseReason };

export function evaluateClosure(
  policy: CollectionPolicy,
  invited: readonly ParticipantId[],
  responded: readonly ParticipantId[],
  now: Date,
): Closure {
  // A deadline closes the brief regardless of how many answered, and it is
  // checked first: a brief past its deadline is closed even if a quorum would
  // also have closed it, and the reason a caller sees should be the honest one.
  if (policy.closeWhen.kind === "deadline") {
    const at = new Date(policy.closeWhen.at);
    if (!Number.isNaN(at.getTime()) && now >= at) return { closed: true, reason: "deadline-passed" };
  }

  const distinct = new Set(responded);
  switch (policy.closeWhen.kind) {
    case "all":
      return invited.length > 0 && distinct.size >= invited.length
        ? { closed: true, reason: "all-responded" }
        : { closed: false };
    case "quorum":
      return distinct.size >= policy.closeWhen.n ? { closed: true, reason: "quorum-reached" } : { closed: false };
    case "deadline":
      return { closed: false };
    case "manual":
      return { closed: false };
  }
}
