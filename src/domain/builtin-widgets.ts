// The shipped vocabulary: the shapes common enough that an agent should never
// have to describe them again.
//
// This file IS the registry. An agent reads it through list_widgets and cannot
// add to it; anything missing is a pull request against this list.
//
// Keeping the set small is the discipline. A widget earns a place by being asked
// for repeatedly, not by being imaginable -- and now that adding one is a review
// rather than a POST, that bar is enforced by something other than good manners.

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
  example: Record<string, Json>,
): WidgetDef => ({ name: named(name), summary, props, layout, example });

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
  
    {
          "title": "Why the nightly job doubled in cost",
          "lead": "The job did not change. Its input did: a partner started sending us every row each night instead of only the ones that changed, so we reprocess 40M rows to find 12,000 that matter.",
          "points": [
                "Cost went from about $30 a night to $240, starting on the 3rd",
                "No deploy went out that week; the code is unchanged",
                "Their API still exposes a `since` parameter, and we stopped sending it"
          ]
    },
  ),

  define(
    "key-facts",
    "Labelled values in a two-column layout. For figures, config, and status at a glance.",
    [req("title", "string", "Heading"), req("facts", "array", "Entries as {key,value}")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { kind: "keyValue", entries: { $: "facts" } },
    ],
  
    {
          "title": "Nightly job, last 7 days",
          "facts": [
                {
                      "key": "Rows in",
                      "value": "40,112,884"
                },
                {
                      "key": "Rows changed",
                      "value": "12,207 (0.03%)"
                },
                {
                      "key": "Runtime",
                      "value": "4h 12m, was 26m"
                },
                {
                      "key": "Cost/night",
                      "value": "$241, was $29"
                }
          ]
    },
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
  
    {
          "title": "Review of the checkout patch",
          "findings": [
                {
                      "tone": "danger",
                      "title": "Refund path is not idempotent",
                      "detail": "A retried webhook issues a second refund. The provider retries on any 5xx, and we return 500 on a DB timeout."
                },
                {
                      "tone": "warn",
                      "title": "Currency is assumed to be GBP",
                      "detail": "Three call sites multiply by 100 to get pence. Correct today, wrong the day we take euros."
                },
                {
                      "tone": "success",
                      "title": "Rollback was tested",
                      "detail": "Restored from snapshot in staging on Monday and timed at 4 minutes."
                }
          ]
    },
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
  
    {
          "title": "Queue options",
          "columns": [
                "Option",
                "Ops burden",
                "Ordering",
                "Cost/month"
          ],
          "rows": [
                [
                      "SQS",
                      "None",
                      "Best effort",
                      "~$12"
                ],
                [
                      "Redis Streams",
                      "We run it",
                      "Per stream",
                      "~$40 (existing box)"
                ],
                [
                      "Postgres table",
                      "None new",
                      "Total",
                      "$0"
                ]
          ],
          "caption": "All three handle the volume. Nothing here is about throughput."
    },
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
  
    {
          "title": "Where the job should run",
          "columns": [
                "Option",
                "Change required",
                "Cost/night",
                "Risk"
          ],
          "rows": [
                [
                      "Send `since` again",
                      "One line",
                      "~$29",
                      "Low, reverts a regression"
                ],
                [
                      "Keep full loads, bigger box",
                      "Config",
                      "~$180",
                      "Low, buys nothing"
                ],
                [
                      "Diff on our side",
                      "New component",
                      "~$35",
                      "We own a cache nobody asked for"
                ]
          ],
          "recommendation": "Send `since` again. It restores the behaviour we had, and the other two treat a regression as a capacity problem."
    },
  ),

  define(
    "timeline",
    "Ordered events with a time and a description. For incident write-ups and change histories.",
    [req("title", "string", "Heading"), req("events", "array", "Events as {when,what}")],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      // $each inside the rows array, so the events become rows of ONE table.
      // Emitting a keyValue block per event stacked a dozen little grids whose
      // columns each sized themselves, and nothing lined up down the page.
      {
        kind: "table",
        columns: ["When", "What"],
        rows: [{ $each: "events", as: "event", body: [[{ $: "event.when" }, { $: "event.what" }]] }],
      },
    ],
  
    {
          "title": "What happened on the 3rd",
          "events": [
                {
                      "when": "02:14",
                      "what": "Nightly job starts as usual"
                },
                {
                      "when": "02:41",
                      "what": "First run to exceed its previous longest, no alert fires"
                },
                {
                      "when": "06:26",
                      "what": "Job finishes, 4h 12m"
                },
                {
                      "when": "09:05",
                      "what": "Cost alert fires on the daily rollup, 12 hours after the cause"
                }
          ]
    },
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
  
    {
          "title": "The line that changed the bill",
          "notes": [
                {
                      "note": "The parameter was dropped when the client was regenerated. Nothing failed, because the API treats it as optional and returns everything.",
                      "code": "- rows = client.list_orders(since=last_run_at)\\n+ rows = client.list_orders()",
                      "language": "diff"
                },
                {
                      "note": "The retry that turns one refund into two: any 5xx is retried by the provider, and a DB timeout returns 500.",
                      "code": "except DatabaseTimeout:\\n    return Response(status=500)",
                      "language": "python"
                }
          ]
    },
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
  
    {
          "title": "Before I change the billing code",
          "context": "The refund path is not idempotent: a retried webhook issues a second refund. Fixing it properly means storing an idempotency key per refund, which is a schema change.",
          "field": {
                "kind": "choice",
                "id": "approach",
                "label": "Which way should I go?",
                "required": true,
                "multiple": false,
                "options": [
                      {
                            "value": "schema",
                            "label": "Idempotency key in the schema, do it properly"
                      },
                      {
                            "value": "guard",
                            "label": "Guard on the existing refund id for now"
                      }
                ]
          }
    },
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
  
    {
          "title": "Before I start the migration",
          "intro": "Three things I cannot answer from the code.",
          "questions": [
                {
                      "kind": "choice",
                      "id": "window",
                      "label": "Which maintenance window?",
                      "required": true,
                      "multiple": false,
                      "options": [
                            {
                                  "value": "sat",
                                  "label": "Saturday 02:00"
                            },
                            {
                                  "value": "sun",
                                  "label": "Sunday 02:00"
                            },
                            {
                                  "value": "none",
                                  "label": "No window, do it live"
                            }
                      ]
                },
                {
                      "kind": "boolean",
                      "id": "backfill",
                      "label": "Backfill historical rows in the same pass?",
                      "required": false
                },
                {
                      "kind": "text",
                      "id": "anything",
                      "label": "Anything I have not asked about?",
                      "required": false,
                      "long": true
                }
          ]
    },
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
  
    {
          "title": "Sign-off needed",
          "proposal": "Re-enable the `since` parameter on the partner client and redeploy the nightly job tonight.",
          "detail": "One line, reverting an unintended change. It restores the behaviour we had before the 3rd. Worst case is that a night is missed and the next run picks it up, because the parameter is a lower bound rather than a filter."
    },
  ),

  define(
    "pick-one",
    "A choice between options, with room to say why. For 'which of these should I do'.",
    [
      req("title", "string", "Heading"),
      opt("context", "string", "Background"),
      req("options", "array", "Options as {value,label}"),
      // Required, because it is bound straight into a label the parser insists
      // on. As an optional it resolved to null and refused the whole brief -- an
      // optional prop that breaks rendering is not optional.
      req("question", "string", "The question shown above the options"),
    ],
    [
      { kind: "heading", level: 2, text: { $: "title" } },
      { $if: "context", then: [{ kind: "prose", text: { $: "context" } }] },
      { kind: "field", spec: { kind: "choice", id: "choice", label: { $: "question" }, required: true, multiple: false, options: { $: "options" } } },
      { kind: "field", spec: { kind: "text", id: "rationale", label: "Why?", required: false, long: true } },
    ],
  
    {
          "title": "Two ways to fix the refund bug",
          "context": "Both stop the double refund. They differ in what we owe afterwards.",
          "question": "Which should I build?",
          "options": [
                {
                      "value": "schema",
                      "label": "Idempotency key column, unique index, provider key stored"
                },
                {
                      "value": "guard",
                      "label": "Check for an existing refund on the order before issuing"
                },
                {
                      "value": "queue",
                      "label": "Serialise refunds through a single worker"
                }
          ]
    },
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
  
    {
          "title": "How much do these worry you?",
          "items": [
                {
                      "id": "double-refund",
                      "label": "Refunds can be issued twice on retry"
                },
                {
                      "id": "currency",
                      "label": "Currency assumed to be GBP in three places"
                },
                {
                      "id": "cost",
                      "label": "Nightly job costing 8x what it did"
                },
                {
                      "id": "alerting",
                      "label": "Cost alert fired 12 hours after the cause"
                }
          ],
          "scale": 5
    },
  ),
];
