import type { Actor } from "../domain/agent.ts";
import type { Brief, Intent, Participant } from "../domain/brief.ts";
import type { Json } from "../domain/json.ts";
import { briefId, participantId } from "../domain/ids.ts";
import { BRIEF_ID_LENGTH } from "../domain/shortid.ts";
import type { ParticipantId } from "../domain/ids.ts";
import { collectsInput } from "../domain/primitives.ts";
import type { CollectionPolicy } from "../domain/policy.ts";
import type { ParsedAll } from "../domain/result.ts";
import { noAll, okAll } from "../domain/result.ts";
import type { Deps } from "./ports.ts";
import { resolveBlocks } from "./resolve-blocks.ts";

export type ParticipantInput = { id?: string; name: string; role?: string };

export type CreateBriefInput = {
  title: string;
  blocks: Json[];
  participants: ParticipantInput[];
  policy: CollectionPolicy;
  intent: Intent;
  linkTtlSeconds: number;
};

// The token is returned once, here. The service stores no participant URL: the
// host serving a brief is deployment configuration, not part of its identity, so
// the caller composes the link from a base URL it knows and this token.
export type Invitation = { participantId: ParticipantId; name: string; token: string };

export type CreateBriefResult = { brief: Brief; invitations: Invitation[] };

export async function createBrief(
  deps: Deps,
  actor: Actor,
  input: CreateBriefInput,
): Promise<ParsedAll<CreateBriefResult>> {
  if (input.title.trim() === "") return noAll(["title: must not be empty"]);
  if (input.intent.purpose.trim() === "") {
    // Not a formality. An ephemeral agent hands off a handle and exits; responses
    // arriving with no record of what they were for leave the orchestrator that
    // picks them up with nothing to act on.
    return noAll(["intent.purpose: required — say what the answers are for"]);
  }

  const blocks = await resolveBlocks(deps.widgets, input.blocks);
  if (!blocks.ok) return blocks;

  const collecting = collectsInput(blocks.value);
  const participants = normaliseParticipants(input.participants);
  if (!participants.ok) return participants;

  if (collecting && participants.value.length === 0) {
    return noAll(["participants: a brief with input fields needs at least one participant"]);
  }

  const id = briefId(deps.ids.fresh(BRIEF_ID_LENGTH));
  if (!id.ok) return noAll([`could not mint a brief id: ${id.reason}`]);

  const now = deps.clock.now().toISOString();
  const brief: Brief = {
    id: id.value,
    ...(actor.kind === "agent" ? { agentId: actor.agentId } : {}),
    title: input.title,
    blocks: blocks.value,
    participants: participants.value,
    policy: input.policy,
    intent: input.intent,
    createdAt: now,
    // A brief that asks for nothing has nothing to wait for. Recording it closed
    // at creation keeps "is there anything outstanding" a single question with a
    // single answer, rather than one that has to know the brief's kind first.
    ...(collecting ? {} : { closedAt: now, closedReason: "no-input-requested" as const }),
  };

  await deps.briefs.create(brief);

  // Links are issued after the brief exists. They reference it, and a link to a
  // brief that failed to store is a 404 handed to a stakeholder.
  const invitations: Invitation[] = [];
  if (collecting) {
    const expiresAt = new Date(deps.clock.now().getTime() + input.linkTtlSeconds * 1000);
    for (const p of participants.value) {
      invitations.push({
        participantId: p.id,
        name: p.name,
        token: await deps.links.issue(brief.id, p.id, expiresAt),
      });
    }
  }

  return okAll({ brief, invitations });
}

function normaliseParticipants(inputs: readonly ParticipantInput[]): ParsedAll<Participant[]> {
  const errors: string[] = [];
  const participants: Participant[] = [];
  const taken = new Set<string>();

  inputs.forEach((input, index) => {
    const at = `participants[${index}]`;
    if (input.name.trim() === "") {
      errors.push(`${at}.name: must not be empty`);
      return;
    }
    const candidate = input.id ?? slugify(input.name);
    const unique = disambiguate(candidate, taken);
    const parsed = participantId(unique);
    if (!parsed.ok) {
      errors.push(`${at}.id: ${parsed.reason}`);
      return;
    }
    taken.add(unique);
    participants.push({
      id: parsed.value,
      name: input.name,
      ...(input.role !== undefined ? { role: input.role } : {}),
    });
  });

  return errors.length > 0 ? noAll(errors) : okAll(participants);
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug === "" ? "participant" : slug;
}

// Two people called Alex are ordinary, and a collision would silently merge their
// answers into one participant.
function disambiguate(candidate: string, taken: ReadonlySet<string>): string {
  if (!taken.has(candidate)) return candidate;
  for (let n = 2; n < 100; n += 1) {
    const next = `${candidate}-${n}`;
    if (!taken.has(next)) return next;
  }
  return `${candidate}-x`;
}
