// Turning a signed request into an actor, or refusing it.

import type { Actor } from "../domain/agent.ts";
import { canonicalRequest, checkFreshness, isActive } from "../domain/agent.ts";
import { agentId } from "../domain/ids.ts";
import type { Deps } from "./ports.ts";

export type SignedRequest = {
  method: string;
  pathWithQuery: string;
  body: string;
  agent: string;
  timestamp: string;
  nonce: string;
  signature: string;
};

export type AuthOutcome = { ok: true; actor: Actor } | { ok: false; reason: string };

export async function authenticate(deps: Deps, request: SignedRequest): Promise<AuthOutcome> {
  const id = agentId(request.agent);
  if (!id.ok) return { ok: false, reason: "unknown agent" };

  const now = deps.clock.now();
  const fresh = checkFreshness(Number(request.timestamp), now);
  if (!fresh.fresh) return { ok: false, reason: fresh.reason };

  const agent = await deps.agents.get(id.value);
  // Same reason either way. Distinguishing "no such agent" from "disabled" tells
  // an unauthenticated caller which ids exist.
  if (agent === undefined || !isActive(agent)) return { ok: false, reason: "unknown agent" };

  const message = canonicalRequest(
    request.method,
    request.pathWithQuery,
    Number(request.timestamp),
    deps.signatures.sha256Hex(request.body),
  );
  if (!deps.signatures.verify(agent.publicKey, message, request.signature)) {
    return { ok: false, reason: "signature does not verify" };
  }

  // Last, deliberately. Burning a nonce for a request that was going to be
  // refused anyway would let anyone invalidate a nonce they guessed.
  if (request.nonce === "" || !deps.nonces.claim(request.nonce, now)) {
    return { ok: false, reason: "nonce missing or already used" };
  }

  return { ok: true, actor: { kind: "agent", agentId: agent.id } };
}
