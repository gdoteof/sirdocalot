import type { BriefId } from "../domain/ids.ts";
import { invitedIds, isClosed } from "../domain/brief.ts";
import { fieldsOf } from "../domain/primitives.ts";
import { evaluateClosure } from "../domain/policy.ts";
import type { Coalesced } from "../domain/response.ts";
import { coalesce } from "../domain/response.ts";
import type { Brief, Deps } from "./ports.ts";

export type Results = { brief: Brief; closed: boolean; results: Coalesced };

// A deadline is the one closure with no event to drive it -- nobody submits at
// the moment it passes. So closure is re-evaluated on read, and a brief found
// past its deadline is closed here. That makes reads the trigger, which is fine
// because reads are exactly what is waiting on the answer.
export async function readResults(deps: Deps, id: BriefId): Promise<Results | undefined> {
  const brief = await deps.briefs.get(id);
  if (brief === undefined) return undefined;

  const responses = await deps.briefs.responsesOf(id);
  const results = coalesce(fieldsOf(brief.blocks), invitedIds(brief), responses);

  if (isClosed(brief)) return { brief, closed: true, results };

  const closure = evaluateClosure(brief.policy, invitedIds(brief), results.responded, deps.clock.now());
  if (!closure.closed || closure.reason === undefined) return { brief, closed: false, results };

  const at = deps.clock.now().toISOString();
  await deps.briefs.close(id, at, closure.reason);
  const closedBrief: Brief = { ...brief, closedAt: at, closedReason: closure.reason };
  await deps.notifier.collectionClosed(closedBrief, closure.reason);
  return { brief: closedBrief, closed: true, results };
}

export async function closeManually(deps: Deps, id: BriefId): Promise<Results | undefined> {
  const brief = await deps.briefs.get(id);
  if (brief === undefined) return undefined;

  if (!isClosed(brief)) {
    const at = deps.clock.now().toISOString();
    await deps.briefs.close(id, at, "closed-manually");
    await deps.notifier.collectionClosed({ ...brief, closedAt: at, closedReason: "closed-manually" }, "closed-manually");
  }
  return readResults(deps, id);
}
