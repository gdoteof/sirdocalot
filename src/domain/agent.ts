// Who is calling, and what they signed.
//
// An agent registers a public key and keeps the private one. Nothing secret is
// ever sent to this service or stored by it, so a copy of this database grants an
// attacker no ability to act as anyone -- which is the entire reason for
// preferring this to handing out bearer tokens.

import type { AgentId } from "./ids.ts";

export type Agent = {
  id: AgentId;
  name: string;
  // Ed25519 public key, base64. The only thing we hold.
  publicKey: string;
  createdAt: string;
  disabledAt?: string;
};

export function isActive(agent: Agent): boolean {
  return agent.disabledAt === undefined;
}

// Who a request is acting as. Admin is the operator's own key, and exists so that
// invite codes can be minted and agents disabled by something that is not itself
// one of the agents.
export type Actor = { kind: "admin" } | { kind: "agent"; agentId: AgentId };

export function ownsBrief(actor: Actor, briefAgentId: AgentId | undefined): boolean {
  // Admin sees everything. An agent sees only what it created -- the first moment
  // a second agent registers, anything else is a data leak.
  if (actor.kind === "admin") return true;
  return briefAgentId !== undefined && briefAgentId === actor.agentId;
}

// WHAT GETS SIGNED. Method, path, timestamp and a digest of the body, joined by
// newlines. Every part is here because leaving it out permits something:
//
//   without the method   a signed GET replays as a DELETE of the same path
//   without the path     a signature for one brief is valid for every brief
//   without the digest   the body can be swapped wholesale
//   without the stamp    a captured signature is valid for ever
//
// The digest rather than the body itself so this stays a small string, and so a
// caller streaming a large body can sign before sending it.
export function canonicalRequest(
  method: string,
  pathWithQuery: string,
  timestamp: number,
  bodySha256Hex: string,
): string {
  return [method.toUpperCase(), pathWithQuery, String(timestamp), bodySha256Hex].join("\n");
}

export const FRESHNESS_WINDOW_SECONDS = 300;

export type Freshness = { fresh: true } | { fresh: false; reason: string };

// Both directions. A stamp far in the future is as much a problem as one far in
// the past: it would let a captured signature be held and used later.
export function checkFreshness(timestamp: number, now: Date): Freshness {
  if (!Number.isFinite(timestamp)) return { fresh: false, reason: "timestamp is not a number" };
  const skew = Math.floor(now.getTime() / 1000) - timestamp;
  if (skew > FRESHNESS_WINDOW_SECONDS) return { fresh: false, reason: "request is too old" };
  if (skew < -FRESHNESS_WINDOW_SECONDS) return { fresh: false, reason: "timestamp is in the future" };
  return { fresh: true };
}
