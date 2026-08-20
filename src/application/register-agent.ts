// Registration: an agent presents a public key and an invite code, and gets an id.
//
// Nothing secret crosses the wire. The agent keeps its private key and this
// service never sees one, so there is no credential here to leak, rotate, or
// accidentally log.

import type { Agent } from "../domain/agent.ts";
import { agentId } from "../domain/ids.ts";
import type { ParsedAll } from "../domain/result.ts";
import { noAll, okAll } from "../domain/result.ts";
import type { Deps } from "./ports.ts";

export type RegisterAgentInput = {
  name: string;
  publicKey: string;
  inviteCode: string;
};

// This runs on one small box that does not scale. The cap is not a security
// control -- the invite code is -- it is a promise to the box.
export const MAX_AGENTS = 200;

// Ed25519 public keys are 32 bytes, which is 44 base64 characters ending in one
// `=`. Checking the shape here means a typo is refused at registration rather
// than becoming an agent that can never authenticate.
const ED25519_B64 = /^[A-Za-z0-9+/]{43}=$/;

export async function registerAgent(deps: Deps, input: RegisterAgentInput): Promise<ParsedAll<Agent>> {
  const errors: string[] = [];
  if (input.name.trim() === "") errors.push("name: must not be empty");
  if (input.name.length > 80) errors.push("name: must be 80 characters or fewer");
  if (!ED25519_B64.test(input.publicKey)) {
    errors.push("publicKey: expected a base64 Ed25519 public key (32 bytes, 44 characters)");
  }
  if (input.inviteCode.trim() === "") errors.push("inviteCode: required");
  if (errors.length > 0) return noAll(errors);

  const alreadyKnown = await deps.agents.byPublicKey(input.publicKey);
  if (alreadyKnown !== undefined) {
    // Not an error worth spending an invite code on: re-registering the same key
    // is what a retried bootstrap looks like, and it should be idempotent.
    return okAll(alreadyKnown);
  }

  if ((await deps.agents.count()) >= MAX_AGENTS) {
    return noAll(["registration is closed: this deployment has reached its agent limit"]);
  }

  const id = agentId(deps.ids.fresh(10));
  if (!id.ok) return noAll([`could not mint an agent id: ${id.reason}`]);

  const agent: Agent = {
    id: id.value,
    name: input.name,
    publicKey: input.publicKey,
    createdAt: deps.clock.now().toISOString(),
  };

  // One commit. Two callers racing the same code cannot both be admitted, and a
  // code cannot be spent on an agent that failed to store. Losing the race is
  // indistinguishable from using a spent code, which is the honest thing to say.
  const admitted = await deps.agents.register(agent, input.inviteCode);
  if (!admitted) return noAll(["inviteCode: not valid, or already used"]);
  return okAll(agent);
}
