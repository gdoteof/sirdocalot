// What a brief can ask for, and what counts as an answer.
//
// Field specs are DATA, not code. They arrive from the widget registry, which is
// rows in a database an agent can write to, so nothing here may depend on a field
// kind being known at compile time beyond this closed set of primitives. Adding a
// new *widget* must never require a deploy; adding a new *primitive* is a deploy,
// which is the trade that keeps this set small and the validator total.

import type { FieldId } from "./ids.ts";

export type FieldSpec =
  | { kind: "text"; id: FieldId; label: string; required: boolean; help?: string; long?: boolean; maxLength?: number }
  | { kind: "number"; id: FieldId; label: string; required: boolean; help?: string; min?: number; max?: number }
  | { kind: "boolean"; id: FieldId; label: string; required: boolean; help?: string }
  | { kind: "choice"; id: FieldId; label: string; required: boolean; help?: string; options: ChoiceOption[]; multiple: boolean }
  | { kind: "rating"; id: FieldId; label: string; required: boolean; help?: string; scale: number };

export type ChoiceOption = { value: string; label: string };

// What a field spec may say, published so an agent does not have to guess it.
//
// Widget props describe a question as "a field spec", and for a long time that
// was the only description there was: the five kinds and the shape of each were
// knowable from this file and nowhere an agent could read. Measured on real
// generations, agents guessed -- `textarea` for long text, snake_case for ids --
// and the API refused briefs that were wrong about a vocabulary nobody published.
//
// Keyed by kind rather than listed, so a new arm of FieldSpec fails to compile
// until it is described here. A vocabulary that can drift from the validator is
// the bug this exists to close.
export const FIELD_KINDS: Record<FieldSpec["kind"], { summary: string; attributes: string }> = {
  text: {
    summary: "Free text. There is no separate textarea kind; a multi-line box is `long: true`.",
    attributes: "long?: boolean for a multi-line box, maxLength?: number",
  },
  number: { summary: "A number.", attributes: "min?: number, max?: number" },
  boolean: { summary: "Yes or no, rendered as a pair of radios.", attributes: "none" },
  choice: {
    summary: "One of a fixed set, or several when multiple is true.",
    attributes: "options: {value,label}[] (required), multiple: boolean (required)",
  },
  rating: { summary: "A whole number on a scale starting at 1.", attributes: "scale: number (required)" },
};

// Every kind takes these; the table above lists only what is particular to it.
export const FIELD_COMMON = "kind, id, label, required — and help? for a line of guidance under the label";

// An answer is the narrowest thing that survives a round trip through an HTML
// form and a JSON column. Everything richer is a composition of these.
export type Answer = string | number | boolean | string[];

export type AnswerError = { field: FieldId; reason: string };

// Total over the closed set above: every kind has an arm, and the compiler proves
// it. A field kind added without a validation arm fails the build rather than
// silently accepting anything.
export function validateAnswer(spec: FieldSpec, raw: Answer | undefined): AnswerError[] {
  const missing = raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);
  if (missing) {
    return spec.required ? [{ field: spec.id, reason: `${spec.label} is required` }] : [];
  }

  switch (spec.kind) {
    case "text": {
      if (typeof raw !== "string") return [{ field: spec.id, reason: "expected text" }];
      if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
        return [{ field: spec.id, reason: `longer than ${spec.maxLength} characters` }];
      }
      return [];
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return [{ field: spec.id, reason: "expected a number" }];
      }
      if (spec.min !== undefined && raw < spec.min) return [{ field: spec.id, reason: `below ${spec.min}` }];
      if (spec.max !== undefined && raw > spec.max) return [{ field: spec.id, reason: `above ${spec.max}` }];
      return [];
    }
    case "boolean": {
      return typeof raw === "boolean" ? [] : [{ field: spec.id, reason: "expected true or false" }];
    }
    case "choice": {
      const allowed = new Set(spec.options.map((o) => o.value));
      const picked = Array.isArray(raw) ? raw : [raw];
      if (!spec.multiple && picked.length > 1) {
        return [{ field: spec.id, reason: "expected a single choice" }];
      }
      const bad = picked.filter((p) => typeof p !== "string" || !allowed.has(p));
      return bad.length === 0 ? [] : [{ field: spec.id, reason: `not an offered option: ${bad.join(", ")}` }];
    }
    case "rating": {
      if (typeof raw !== "number" || !Number.isInteger(raw)) {
        return [{ field: spec.id, reason: "expected a whole number" }];
      }
      return raw >= 1 && raw <= spec.scale ? [] : [{ field: spec.id, reason: `outside 1..${spec.scale}` }];
    }
  }
}

export function validateAnswers(
  specs: readonly FieldSpec[],
  answers: Readonly<Record<string, Answer>>,
): AnswerError[] {
  const errors = specs.flatMap((spec) => validateAnswer(spec, answers[spec.id]));

  // An answer to a field the brief never asked about is a refusal, not something
  // to quietly drop: it means the responder saw a different brief than the one
  // stored, and accepting it would record data against a question nobody asked.
  const known = new Set<string>(specs.map((s) => s.id));
  const stray = Object.keys(answers).filter((k) => !known.has(k));
  return [...errors, ...stray.map((k) => ({ field: k as FieldId, reason: "not a field of this brief" }))];
}
