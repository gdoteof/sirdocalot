// The document an agent emits, and everything needed to act on what comes back.

import type { AgentId, BriefId, ParticipantId } from "./ids.ts";
import type { PrimitiveBlock } from "./primitives.ts";
import type { CloseReason, CollectionPolicy } from "./policy.ts";

// Why this brief exists, in terms an orchestrator can act on without the session
// that asked. Required, not optional: an ephemeral agent hands off a handle and
// exits, and responses arriving with no record of what they were for leave
// whatever picks them up with nothing to do.
export type Intent = {
  purpose: string;
  // Free-form hook for whatever the orchestrator uses to find its way back --
  // a session id, a branch, a ticket. The service never interprets it.
  resumeHint?: string;
};

export type Participant = {
  id: ParticipantId;
  name: string;
  role?: string;
};

export type Brief = {
  id: BriefId;
  // Which agent created it. Absent only on briefs made before agents existed,
  // which is why it is optional rather than required -- and why ownsBrief() in
  // agent.ts treats an absent owner as owned by nobody but admin.
  agentId?: AgentId;
  title: string;
  blocks: PrimitiveBlock[];
  participants: Participant[];
  policy: CollectionPolicy;
  intent: Intent;
  createdAt: string;
  closedAt?: string;
  closedReason?: CloseReason;
};

export function isClosed(brief: Brief): boolean {
  return brief.closedAt !== undefined;
}

export function invitedIds(brief: Brief): ParticipantId[] {
  return brief.participants.map((p) => p.id);
}

export function participantOf(brief: Brief, id: ParticipantId): Participant | undefined {
  return brief.participants.find((p) => p.id === id);
}
