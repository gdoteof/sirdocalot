// The shipped vocabulary: the shapes common enough that an agent should never
// have to describe them again.
//
// These are ordinary widget definitions with `builtin: true` -- there is no
// second mechanism. An agent reads them with list_widgets, and anything it needs
// that is not here it defines the same way these are written.
//
// Keeping this set small is the discipline. A widget earns a place by being asked
// for repeatedly, not by being imaginable.

import type { Json } from "./json.ts";
import { widgetName } from "./ids.ts";
import type { WidgetDef } from "./widget.ts";

// A malformed builtin is a bug in this file, not a runtime condition to report.
// Failing at import is the loudest available signal and the earliest.
function named(raw: string) {
  const parsed = widgetName(raw);
  if (!parsed.ok) throw new Error(`builtin widget has an invalid name: ${raw}`);
  return parsed.value;
}

const define = (
  name: string,
  summary: string,
  props: WidgetDef["props"],
  layout: Json[],
): WidgetDef => ({ name: named(name), summary, props, layout, builtin: true });

const req = (name: string, type: WidgetDef["props"][number]["type"], description: string) => ({
  name,
  type,
  required: true,
  description,
});
const opt = (name: string, type: WidgetDef["props"][number]["type"], description: string) => ({
  name,
  type,
  required: false,
  description,
});

export const BUILTIN_WIDGETS: WidgetDef[] = [
  // ---------------------------------------------------------------- read-only --
  define(
    "summary",
    "A title, a lead paragraph, and the points that matter. The default way to replace a wall of text.",
    [req("title", "string", "Heading"), req("lead", "string", "One-paragraph summary"), opt("points", "array", "Key points as strings")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { kind: "prose", text: { $: "lead" } },
      { $if: "points", then: [{ kind: "list", ordered: false, items: { $: "points" } }] },
    ],
  ),

  define(
    "key-facts",
    "Labelled values in a two-column layout. For figures, config, and status at a glance.",
    [req("title", "string", "Heading"), req("facts", "array", "Entries as {key,value}")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { kind: "keyValue", entries: { $: "facts" } },
    ],
  ),

  define(
    "findings",
    "A list of findings, each in its own callout, coloured by tone. For reviews, audits, and diagnostics.",
    [req("title", "string", "Heading"), req("findings", "array", "Items as {tone,title,detail}; tone is info|warn|success|danger")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      {
        $each: "findings",
        as: "finding",
        body: [{ kind: "callout", tone: { $: "finding.tone" }, title: { $: "finding.title" }, text: { $: "finding.detail" } }],
      },
    ],
  ),

  define(
    "comparison",
    "A table with a heading and an optional caption. For comparing options across the same dimensions.",
    [
      req("title", "string", "Heading"),
      req("columns", "array", "Column headers"),
      req("rows", "array", "Rows, each an array of cells matching columns"),
      opt("caption", "string", "Note shown under the table"),
    ],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { kind: "table", columns: { $: "columns" }, rows: { $: "rows" }, caption: { $: "caption" } },
    ],
  ),

  define(
    "decision-matrix",
    "A comparison table plus a stated recommendation. Use when the point is the conclusion, not the data.",
    [
      req("title", "string", "Heading"),
      req("columns", "array", "Column headers, first one naming the option"),
      req("rows", "array", "Rows, each an array of cells matching columns"),
      opt("recommendation", "string", "What the agent recommends and why"),
    ],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { kind: "table", columns: { $: "columns" }, rows: { $: "rows" } },
      { $if: "recommendation", then: [{ kind: "callout", tone: "success", title: "Recommendation", text: { $: "recommendation" } }] },
    ],
  ),

  define(
    "timeline",
    "Ordered events with a time and a description. For incident write-ups and change histories.",
    [req("title", "string", "Heading"), req("events", "array", "Events as {when,what}")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { $each: "events", as: "event", body: [{ kind: "keyValue", entries: [{ key: { $: "event.when" }, value: { $: "event.what" } }] }] },
    ],
  ),

  define(
    "annotated-code",
    "Code blocks each preceded by the note explaining them. For diffs, snippets, and walkthroughs.",
    [req("title", "string", "Heading"), req("notes", "array", "Items as {note,code,language}")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      {
        $each: "notes",
        as: "note",
        body: [
          { kind: "prose", text: { $: "note.note" } },
          { kind: "code", text: { $: "note.code" }, language: { $: "note.language" } },
        ],
      },
    ],
  ),

  // ------------------------------------------------------------------ collects --
  define(
    "ask",
    "One question, with optional context above it. The smallest collecting brief.",
    [req("title", "string", "Heading"), opt("context", "string", "Background shown before the question"), req("field", "object", "A field spec: {kind,id,label,required,...}")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { $if: "context", then: [{ kind: "prose", text: { $: "context" } }] },
      { kind: "field", spec: { $: "field" } },
    ],
  ),

  define(
    "survey",
    "Several questions under one heading. Field specs are passed through as given.",
    [req("title", "string", "Heading"), opt("intro", "string", "Text shown before the questions"), req("questions", "array", "Field specs")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { $if: "intro", then: [{ kind: "prose", text: { $: "intro" } }] },
      { $each: "questions", as: "question", body: [{ kind: "field", spec: { $: "question" } }] },
    ],
  ),

  define(
    "approval",
    "A summary of what is proposed, a three-way decision, and room for reasoning.",
    [req("title", "string", "Heading"), req("proposal", "string", "What is being proposed"), opt("detail", "string", "Longer explanation")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { kind: "callout", tone: "info", title: "Proposed", text: { $: "proposal" } },
      { $if: "detail", then: [{ kind: "prose", text: { $: "detail" } }] },
      {
        kind: "field",
        spec: {
          kind: "choice",
          id: "decision",
          label: "Your decision",
          required: true,
          multiple: false,
          options: [
            { value: "approve", label: "Approve" },
            { value: "needs-changes", label: "Needs changes" },
            { value: "reject", label: "Reject" },
          ],
        },
      },
      { kind: "field", spec: { kind: "text", id: "reasoning", label: "Reasoning", required: false, long: true } },
    ],
  ),

  define(
    "pick-one",
    "A choice between options, with room to say why. For 'which of these should I do'.",
    [req("title", "string", "Heading"), opt("context", "string", "Background"), req("options", "array", "Options as {value,label}"), opt("question", "string", "Question text")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { $if: "context", then: [{ kind: "prose", text: { $: "context" } }] },
      { kind: "field", spec: { kind: "choice", id: "choice", label: { $: "question" }, required: true, multiple: false, options: { $: "options" } } },
      { kind: "field", spec: { kind: "text", id: "rationale", label: "Why?", required: false, long: true } },
    ],
  ),

  define(
    "rate-items",
    "The same rating scale applied to several items. For prioritisation and confidence checks.",
    [req("title", "string", "Heading"), req("items", "array", "Items as {id,label}"), opt("scale", "number", "Highest rating, default 5")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      {
        $each: "items",
        as: "item",
        body: [{ kind: "field", spec: { kind: "rating", id: { $: "item.id" }, label: { $: "item.label" }, required: false, scale: { $: "scale" } } }],
      },
    ],
  ),
];
