// Identifiers carried as branded strings rather than bare ones. A brief id and a
// participant id are both opaque text at runtime, and passing one where the other
// belongs is the mistake the compiler can catch for free.

declare const brand: unique symbol;
type Branded<T, B> = T & { readonly [brand]: B };

export type BriefId = Branded<string, "BriefId">;
export type AgentId = Branded<string, "AgentId">;
export type ParticipantId = Branded<string, "ParticipantId">;
export type WidgetName = Branded<string, "WidgetName">;
export type FieldId = Branded<string, "FieldId">;

// Parse, do not validate: these are the only way into the branded types, and they
// refuse rather than throw so the caller cannot forget to handle the refusal.
import type { Parsed } from "./result.ts";
import { ok, no } from "./result.ts";

// Slug shape is shared by every identifier here. It is URL-safe by construction,
// which is what lets an id appear in a participant link without escaping.
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function agentId(raw: string): Parsed<AgentId> {
  return SLUG.test(raw) ? ok(raw as AgentId) : no(`not a valid agent id: ${raw}`);
}

export function briefId(raw: string): Parsed<BriefId> {
  return SLUG.test(raw) ? ok(raw as BriefId) : no(`not a valid brief id: ${raw}`);
}

export function participantId(raw: string): Parsed<ParticipantId> {
  return SLUG.test(raw) ? ok(raw as ParticipantId) : no(`not a valid participant id: ${raw}`);
}

export function widgetName(raw: string): Parsed<WidgetName> {
  return SLUG.test(raw) ? ok(raw as WidgetName) : no(`not a valid widget name: ${raw}`);
}

export function fieldId(raw: string): Parsed<FieldId> {
  return SLUG.test(raw) ? ok(raw as FieldId) : no(`not a valid field id: ${raw}`);
}
