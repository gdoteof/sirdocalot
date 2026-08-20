// The compiled-in vocabulary. Every brief, however it was authored, is a list of
// these by the time it reaches a renderer.
//
// This set is deliberately small and grows slowly. It is the one tier that costs
// a deploy, so anything expressible as a composition of what is already here
// belongs in the widget registry instead -- see widget.ts.

import type { FieldSpec } from "./fields.ts";

export type Tone = "info" | "warn" | "success" | "danger";

export type PrimitiveBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "prose"; text: string }
  | { kind: "callout"; tone: Tone; text: string; title?: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "keyValue"; entries: { key: string; value: string }[] }
  | { kind: "table"; columns: string[]; rows: string[][]; caption?: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "divider" }
  | { kind: "field"; spec: FieldSpec }
  // Tier three: markup the primitives cannot express. Renderers must sandbox it.
  // It is here so the escape hatch exists, and named so it is obvious in a brief
  // which parts were not expressible in the vocabulary.
  | { kind: "raw"; html: string };

export const PRIMITIVE_KINDS = [
  "heading",
  "prose",
  "callout",
  "list",
  "keyValue",
  "table",
  "code",
  "divider",
  "field",
  "raw",
] as const;

export function isPrimitiveKind(k: string): boolean {
  return (PRIMITIVE_KINDS as readonly string[]).includes(k);
}

// A brief collects if any block asks for something. Derived rather than declared:
// a stored flag would be a second source of truth, and it would be the one that
// goes stale when a widget's layout changes under an existing brief.
export function collectsInput(blocks: readonly PrimitiveBlock[]): boolean {
  return blocks.some((b) => b.kind === "field");
}

export function fieldsOf(blocks: readonly PrimitiveBlock[]): FieldSpec[] {
  return blocks.flatMap((b) => (b.kind === "field" ? [b.spec] : []));
}
