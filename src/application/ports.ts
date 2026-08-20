// Ports the application declares and something outside implements.
//
// Declared here rather than beside their implementations: a port sitting next to
// its only implementation is a header file, and the dependency still points the
// wrong way. Clock and IdSource are ports for the same reason as everything else
// -- they are ambient capabilities, and a use case that reaches for them directly
// cannot be tested without the real world supplying an answer.

import type { Agent, Actor } from "../domain/agent.ts";
import type { Brief, Intent, Participant } from "../domain/brief.ts";
import type { Answer } from "../domain/fields.ts";
import type { Coalesced } from "../domain/response.ts";
import type { AgentId, BriefId, ParticipantId, WidgetName } from "../domain/ids.ts";
import type { CloseReason } from "../domain/policy.ts";
import type { Response } from "../domain/response.ts";
import type { WidgetDef } from "../domain/widget.ts";

export type BriefStore = {
  create(brief: Brief): Promise<void>;
  get(id: BriefId): Promise<Brief | undefined>;
  close(id: BriefId, at: string, reason: CloseReason): Promise<void>;
  recordResponse(id: BriefId, response: Response): Promise<void>;
  responsesOf(id: BriefId): Promise<Response[]>;
};

// Read-only. Widgets are a reviewed change to the shipped set, so there is no
// write path to declare here.
export type WidgetStore = {
  get(name: WidgetName): Promise<WidgetDef | undefined>;
  list(): Promise<WidgetDef[]>;
};

export type Clock = { now(): Date };

export type IdSource = { fresh(length?: number): string };

// A participant link names a (brief, participant) pair. It is a capability, not a
// credential: whoever holds it may answer as that participant. That weakness is
// accepted deliberately -- see docs/DESIGN.md.
//
// Stored rather than signed. A signed token carries its own claims and needs no
// lookup, which sounds like the better trade until you notice that resolving one
// still loads the brief from the same database. The signature bought nothing and
// cost a 150-character URL that wrapped in every mail client -- and a signed token
// cannot be revoked, while a row can.
export type ParticipantLinks = {
  issue(briefId: BriefId, participantId: ParticipantId, expiresAt: Date): Promise<string>;
  resolve(token: string, now: Date): Promise<{ briefId: BriefId; participantId: ParticipantId } | undefined>;
};

export type AgentStore = {
  // Claiming the invite code and creating the agent are ONE commit. A code is
  // spent if and only if an agent exists because of it, and that invariant cannot
  // be spread across two writes and a hope that the second one arrives. Returns
  // whether the code was still claimable.
  register(agent: Agent, inviteCode: string): Promise<boolean>;
  get(id: AgentId): Promise<Agent | undefined>;
  byPublicKey(publicKey: string): Promise<Agent | undefined>;
  list(): Promise<Agent[]>;
  disable(id: AgentId, at: string): Promise<void>;
  count(): Promise<number>;
};

export type InviteCodes = {
  create(code: string, note: string | undefined): Promise<void>;
  list(): Promise<{ code: string; note?: string; usedBy?: string; usedAt?: string }[]>;
};

export type Signatures = {
  verify(publicKeyBase64: string, message: string, signatureBase64: string): boolean;
  sha256Hex(body: string): string;
};

// Replay guard. A signature stays valid for its whole freshness window, so
// something has to remember what it has already honoured within that window.
export type Nonces = { claim(nonce: string, now: Date): boolean };

export type Notifier = {
  collectionClosed(brief: Brief, reason: CloseReason): Promise<void>;
};

// One port, two implementations: the hosted page and the Claude artifact. The
// view carries everything either target needs, so neither implementation has to
// know which one it is -- if a renderer ever asks that question, this type is
// missing a field.
export type RenderView = {
  brief: Brief;
  form?: {
    participant: Participant;
    action: string;
    errors: Record<string, string>;
    values: Record<string, Answer>;
  };
  results?: Coalesced;
  banner?: { title: string; body: string };
};

export type Renderer = { render(view: RenderView): string };

export type Deps = {
  briefs: BriefStore;
  widgets: WidgetStore;
  agents: AgentStore;
  invites: InviteCodes;
  links: ParticipantLinks;
  clock: Clock;
  ids: IdSource;
  signatures: Signatures;
  nonces: Nonces;
  notifier: Notifier;
};

export type { Actor, Agent, Brief, Intent, Participant, Response, WidgetDef };
