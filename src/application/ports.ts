// Ports the application declares and something outside implements.
//
// Declared here rather than beside their implementations: a port sitting next to
// its only implementation is a header file, and the dependency still points the
// wrong way. Clock and IdSource are ports for the same reason as everything else
// -- they are ambient capabilities, and a use case that reaches for them directly
// cannot be tested without the real world supplying an answer.

import type { Brief, Intent, Participant } from "../domain/brief.ts";
import type { Answer } from "../domain/fields.ts";
import type { Coalesced } from "../domain/response.ts";
import type { BriefId, ParticipantId, WidgetName } from "../domain/ids.ts";
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

export type WidgetStore = {
  get(name: WidgetName): Promise<WidgetDef | undefined>;
  list(): Promise<WidgetDef[]>;
  define(def: WidgetDef): Promise<void>;
};

export type Clock = { now(): Date };

export type IdSource = { fresh(): string };

// A participant token names a (brief, participant) pair and proves the service
// minted it. It is a capability, not a credential: whoever holds it may answer as
// that participant. That weakness is accepted deliberately -- see docs/DESIGN.md.
export type ParticipantTokens = {
  mint(briefId: BriefId, participantId: ParticipantId): string;
  verify(token: string): { briefId: BriefId; participantId: ParticipantId } | undefined;
};

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
  clock: Clock;
  ids: IdSource;
  tokens: ParticipantTokens;
  notifier: Notifier;
};

export type { Brief, Intent, Participant, Response, WidgetDef };
