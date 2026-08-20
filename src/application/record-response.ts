import type { Answer, AnswerError } from "../domain/fields.ts";
import { validateAnswers } from "../domain/fields.ts";
import { fieldsOf } from "../domain/primitives.ts";
import { invitedIds, isClosed, participantOf } from "../domain/brief.ts";
import { evaluateClosure } from "../domain/policy.ts";
import type { Brief, Deps } from "./ports.ts";

// Two refusals with different audiences: field errors go back onto the form
// beside the input that caused them, and a rejection is a whole-page condition.
// Flattening both into strings would make the form layer parse prose to find out
// which input to mark.
export type RecordOutcome =
  | { ok: true; brief: Brief; closed: boolean }
  | { ok: false; kind: "invalid"; fieldErrors: AnswerError[] }
  | { ok: false; kind: "rejected"; reason: string };

export async function recordResponse(
  deps: Deps,
  token: string,
  answers: Record<string, Answer>,
): Promise<RecordOutcome> {
  const claim = await deps.links.resolve(token, deps.clock.now());
  if (claim === undefined) return { ok: false, kind: "rejected", reason: "This link is not valid, or it has expired." };

  const brief = await deps.briefs.get(claim.briefId);
  if (brief === undefined) return { ok: false, kind: "rejected", reason: "This brief no longer exists." };
  if (isClosed(brief)) return { ok: false, kind: "rejected", reason: "Collection has closed for this brief." };

  const participant = participantOf(brief, claim.participantId);
  if (participant === undefined) {
    return { ok: false, kind: "rejected", reason: "This link is not for a participant of this brief." };
  }

  const fieldErrors = validateAnswers(fieldsOf(brief.blocks), answers);
  if (fieldErrors.length > 0) return { ok: false, kind: "invalid", fieldErrors };

  await deps.briefs.recordResponse(brief.id, {
    participantId: participant.id,
    submittedAt: deps.clock.now().toISOString(),
    answers,
  });

  // Re-read rather than reason about what the write did: two participants can
  // submit concurrently, and whichever the store ordered second is the one that
  // closes the brief. Deciding from a local count would let both think they were
  // first, or neither.
  const responses = await deps.briefs.responsesOf(brief.id);
  const closure = evaluateClosure(
    brief.policy,
    invitedIds(brief),
    responses.map((r) => r.participantId),
    deps.clock.now(),
  );

  if (closure.closed && closure.reason !== undefined) {
    const at = deps.clock.now().toISOString();
    await deps.briefs.close(brief.id, at, closure.reason);
    const closedBrief: Brief = { ...brief, closedAt: at, closedReason: closure.reason };
    await deps.notifier.collectionClosed(closedBrief, closure.reason);
    return { ok: true, brief: closedBrief, closed: true };
  }

  return { ok: true, brief, closed: false };
}
