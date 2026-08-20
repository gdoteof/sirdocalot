import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAnswers } from "../src/domain/fields.ts";
import type { FieldSpec } from "../src/domain/fields.ts";
import type { FieldId, ParticipantId } from "../src/domain/ids.ts";
import { fieldId, participantId } from "../src/domain/ids.ts";
import { expand, validateProps } from "../src/domain/widget.ts";
import type { WidgetDef } from "../src/domain/widget.ts";
import { widgetName } from "../src/domain/ids.ts";
import { parseBlocks } from "../src/domain/parse.ts";
import { evaluateClosure } from "../src/domain/policy.ts";
import { coalesce } from "../src/domain/response.ts";
import { canonicalRequest, checkFreshness, ownsBrief } from "../src/domain/agent.ts";
import { agentId } from "../src/domain/ids.ts";
import { ALPHABET, encode } from "../src/domain/shortid.ts";
import { BUILTIN_WIDGETS } from "../src/domain/builtin-widgets.ts";
import type { Json } from "../src/domain/json.ts";

const fid = (s: string): FieldId => {
  const parsed = fieldId(s);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
};
const pid = (s: string): ParticipantId => {
  const parsed = participantId(s);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
};

describe("answer validation", () => {
  const choice: FieldSpec = {
    kind: "choice",
    id: fid("decision"),
    label: "Decision",
    required: true,
    multiple: false,
    options: [
      { value: "approve", label: "Approve" },
      { value: "reject", label: "Reject" },
    ],
  };

  it("requires a required field", () => {
    const errors = validateAnswers([choice], {});
    strictEqual(errors.length, 1);
    strictEqual(errors[0]?.field, "decision");
  });

  it("refuses an option that was never offered", () => {
    const errors = validateAnswers([choice], { decision: "maybe" });
    strictEqual(errors.length, 1);
  });

  it("refuses several picks on a single-choice field", () => {
    const errors = validateAnswers([choice], { decision: ["approve", "reject"] });
    strictEqual(errors.length, 1);
  });

  it("refuses an answer to a field the brief never asked", () => {
    const errors = validateAnswers([choice], { decision: "approve", smuggled: "x" });
    deepStrictEqual(
      errors.map((e) => e.field),
      ["smuggled"],
    );
  });

  it("holds a rating inside its scale", () => {
    const rating: FieldSpec = { kind: "rating", id: fid("confidence"), label: "Confidence", required: false, scale: 5 };
    strictEqual(validateAnswers([rating], { confidence: 5 }).length, 0);
    strictEqual(validateAnswers([rating], { confidence: 6 }).length, 1);
  });
});

describe("widget expansion", () => {
  const def = (layout: WidgetDef["layout"], props: WidgetDef["props"] = []): WidgetDef => {
    const name = widgetName("probe");
    if (!name.ok) throw new Error(name.reason);
    return { name: name.value, summary: "probe", props, layout, example: {} };
  };

  it("substitutes a whole array through one binding", () => {
    const blocks = expand(def([{ kind: "list", ordered: false, items: { $: "points" } }]), {
      points: ["one", "two"],
    });
    deepStrictEqual(blocks, [{ kind: "list", ordered: false, items: ["one", "two"] }]);
  });

  it("repeats a body per item and exposes the alias", () => {
    const blocks = expand(
      def([{ $each: "rows", as: "row", body: [{ kind: "prose", text: { $: "row.label" } }] }]),
      { rows: [{ label: "a" }, { label: "b" }] },
    );
    deepStrictEqual(blocks, [
      { kind: "prose", text: "a" },
      { kind: "prose", text: "b" },
    ]);
  });

  it("drops a conditional branch whose prop is absent", () => {
    const layout = [{ $if: "note", then: [{ kind: "prose", text: { $: "note" } }] }];
    deepStrictEqual(expand(def(layout), {}), []);
    deepStrictEqual(expand(def(layout), { note: "hi" }), [{ kind: "prose", text: "hi" }]);
  });

  it("refuses an undeclared prop rather than ignoring it", () => {
    const errors = validateProps(def([], [{ name: "title", type: "string", required: true }]), {
      title: "t",
      colour: "red",
    });
    strictEqual(errors.length, 1);
  });
});

describe("block parsing", () => {
  it("refuses a ragged table", () => {
    const parsed = parseBlocks([{ kind: "table", columns: ["a", "b"], rows: [["1"]] }]);
    strictEqual(parsed.ok, false);
  });

  it("refuses two fields sharing an id", () => {
    const spec = { kind: "text", id: "note", label: "Note", required: false };
    const parsed = parseBlocks([
      { kind: "field", spec },
      { kind: "field", spec },
    ]);
    strictEqual(parsed.ok, false);
  });

  it("refuses an unknown block kind", () => {
    strictEqual(parseBlocks([{ kind: "carousel" }]).ok, false);
  });
});

describe("collection policy", () => {
  const invited = [pid("alex"), pid("sam"), pid("kit")];
  const now = new Date("2026-08-20T12:00:00Z");

  it("closes on all only when everyone answered", () => {
    const policy = { closeWhen: { kind: "all" as const }, visibility: "blind" as const };
    strictEqual(evaluateClosure(policy, invited, [pid("alex"), pid("sam")], now).closed, false);
    strictEqual(evaluateClosure(policy, invited, invited, now).reason, "all-responded");
  });

  it("closes on quorum", () => {
    const policy = { closeWhen: { kind: "quorum" as const, n: 2 }, visibility: "blind" as const };
    strictEqual(evaluateClosure(policy, invited, [pid("alex")], now).closed, false);
    strictEqual(evaluateClosure(policy, invited, [pid("alex"), pid("sam")], now).reason, "quorum-reached");
  });

  it("counts a participant once however often they resubmit", () => {
    const policy = { closeWhen: { kind: "quorum" as const, n: 2 }, visibility: "blind" as const };
    strictEqual(evaluateClosure(policy, invited, [pid("alex"), pid("alex")], now).closed, false);
  });

  it("closes once the deadline has passed, whoever answered", () => {
    const policy = { closeWhen: { kind: "deadline" as const, at: "2026-08-20T11:00:00Z" }, visibility: "blind" as const };
    strictEqual(evaluateClosure(policy, invited, [], now).reason, "deadline-passed");
  });

  it("never closes a manual brief on its own", () => {
    const policy = { closeWhen: { kind: "manual" as const }, visibility: "blind" as const };
    strictEqual(evaluateClosure(policy, invited, invited, now).closed, false);
  });
});

describe("coalescing", () => {
  const field: FieldSpec = {
    kind: "choice",
    id: fid("decision"),
    label: "Decision",
    required: true,
    multiple: false,
    options: [
      { value: "approve", label: "Approve" },
      { value: "reject", label: "Reject" },
    ],
  };
  const invited = [pid("alex"), pid("sam")];

  it("reports a disagreement instead of resolving it", () => {
    const results = coalesce(
      [field],
      invited,
      [
        { participantId: pid("alex"), submittedAt: "2026-08-20T10:00:00Z", answers: { decision: "approve" } },
        { participantId: pid("sam"), submittedAt: "2026-08-20T10:05:00Z", answers: { decision: "reject" } },
      ],
    );
    deepStrictEqual(results.conflicts, ["decision"]);
    strictEqual(results.fields[0]?.answers.length, 2);
  });

  it("takes the latest submission from one participant", () => {
    const results = coalesce(
      [field],
      invited,
      [
        { participantId: pid("alex"), submittedAt: "2026-08-20T10:00:00Z", answers: { decision: "approve" } },
        { participantId: pid("alex"), submittedAt: "2026-08-20T11:00:00Z", answers: { decision: "reject" } },
      ],
    );
    strictEqual(results.responded.length, 1);
    strictEqual(results.fields[0]?.answers[0]?.value, "reject");
    deepStrictEqual(results.conflicts, []);
  });

  it("does not call a reordered multi-choice a disagreement", () => {
    const multi: FieldSpec = { ...field, multiple: true };
    const results = coalesce(
      [multi],
      invited,
      [
        { participantId: pid("alex"), submittedAt: "2026-08-20T10:00:00Z", answers: { decision: ["approve", "reject"] } },
        { participantId: pid("sam"), submittedAt: "2026-08-20T10:01:00Z", answers: { decision: ["reject", "approve"] } },
      ],
    );
    deepStrictEqual(results.conflicts, []);
  });

  it("names who has not answered", () => {
    const results = coalesce([field], invited, [
      { participantId: pid("alex"), submittedAt: "2026-08-20T10:00:00Z", answers: { decision: "approve" } },
    ]);
    deepStrictEqual(results.outstanding, ["sam"]);
  });
});

describe("what counts as a disagreement", () => {
  const invited = [pid("alex"), pid("sam")];
  const prose: FieldSpec = { kind: "text", id: fid("reasoning"), label: "Reasoning", required: false, long: true };
  const pick: FieldSpec = {
    kind: "choice",
    id: fid("decision"),
    label: "Decision",
    required: true,
    multiple: false,
    options: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  };

  const responses = [
    { participantId: pid("alex"), submittedAt: "2026-08-20T10:00:00Z", answers: { decision: "yes", reasoning: "looks fine" } },
    { participantId: pid("sam"), submittedAt: "2026-08-20T10:01:00Z", answers: { decision: "yes", reasoning: "agreed, ship it" } },
  ];

  it("does not call two different free-text answers a conflict", () => {
    const results = coalesce([pick, prose], invited, responses);
    deepStrictEqual(results.conflicts, []);
  });

  it("still records that the prose differed", () => {
    const results = coalesce([pick, prose], invited, responses);
    strictEqual(results.fields.find((f) => f.field.id === "reasoning")?.agreed, false);
  });

  it("reports a conflict when the bounded answers differ", () => {
    const split = [
      responses[0]!,
      { participantId: pid("sam"), submittedAt: "2026-08-20T10:01:00Z", answers: { decision: "no", reasoning: "no" } },
    ];
    deepStrictEqual(coalesce([pick, prose], invited, split).conflicts, ["decision"]);
  });
});

describe("agent identity", () => {
  it("signs over every part that would otherwise be swappable", () => {
    const base = canonicalRequest("post", "/api/briefs", 1000, "abc");
    // Each of these differs from the base, which is the property the signature
    // relies on: change any component and the signature no longer matches.
    strictEqual(canonicalRequest("GET", "/api/briefs", 1000, "abc") === base, false);
    strictEqual(canonicalRequest("POST", "/api/briefs/x", 1000, "abc") === base, false);
    strictEqual(canonicalRequest("POST", "/api/briefs", 1001, "abc") === base, false);
    strictEqual(canonicalRequest("POST", "/api/briefs", 1000, "abd") === base, false);
  });

  it("normalises the method so case is not a second signature", () => {
    strictEqual(canonicalRequest("post", "/x", 1, "d"), canonicalRequest("POST", "/x", 1, "d"));
  });

  it("refuses a stamp that is too old and one that is too far ahead", () => {
    const now = new Date("2026-08-20T12:00:00Z");
    const unix = Math.floor(now.getTime() / 1000);
    strictEqual(checkFreshness(unix, now).fresh, true);
    strictEqual(checkFreshness(unix - 299, now).fresh, true);
    strictEqual(checkFreshness(unix - 301, now).fresh, false);
    strictEqual(checkFreshness(unix + 301, now).fresh, false);
  });
});

describe("brief ownership", () => {
  const a = agentId("aaaa");
  const b = agentId("bbbb");
  if (!a.ok || !b.ok) throw new Error("fixture ids");

  it("lets an agent see only its own", () => {
    strictEqual(ownsBrief({ kind: "agent", agentId: a.value }, a.value), true);
    strictEqual(ownsBrief({ kind: "agent", agentId: a.value }, b.value), false);
  });

  it("does not hand an ownerless brief to an agent", () => {
    strictEqual(ownsBrief({ kind: "agent", agentId: a.value }, undefined), false);
  });

  it("lets admin see everything, owned or not", () => {
    strictEqual(ownsBrief({ kind: "admin" }, b.value), true);
    strictEqual(ownsBrief({ kind: "admin" }, undefined), true);
  });
});

describe("short ids", () => {
  it("draws only from the unambiguous alphabet", () => {
    const bytes = new Uint8Array(Array.from({ length: 64 }, (_, i) => i * 7));
    const encoded = encode(bytes, 32);
    strictEqual(encoded.length, 32);
    strictEqual([...encoded].every((ch) => ALPHABET.includes(ch)), true);
    // The characters people transcribe wrongly are absent by construction.
    strictEqual(/[01ilou]/.test(encoded), false);
  });
});

describe("every shipped widget renders", () => {
  for (const widget of BUILTIN_WIDGETS) {
    it(`${widget.name} expands to valid blocks`, () => {
      const props = widget.example;
      deepStrictEqual(validateProps(widget, props), []);
      const parsed = parseBlocks(expand(widget, props));
      if (!parsed.ok) throw new Error(`${widget.name}: ${parsed.errors.join("; ")}`);
      strictEqual(parsed.value.length > 0, true);
    });
  }

  it("omitting an optional prop still renders", () => {
    // The failure this catches: a prop declared optional but bound into a
    // required field, so leaving it out refuses the whole brief.
    const optionalsDropped: Record<string, Record<string, Json>> = {
      "annotated-code": { title: "T", notes: [{ note: "n", code: "x = 1" }] },
      comparison: { title: "T", columns: ["a"], rows: [["1"]] },
      "decision-matrix": { title: "T", columns: ["a"], rows: [["1"]] },
      ask: { title: "T", field: { kind: "text", id: "q", label: "Q", required: false } },
      survey: { title: "T", questions: [{ kind: "text", id: "q", label: "Q", required: false }] },
      approval: { title: "T", proposal: "p" },
      "pick-one": { title: "T", question: "Which?", options: [{ value: "a", label: "A" }] },
      "rate-items": { title: "T", items: [{ id: "a", label: "A" }] },
      summary: { title: "T", lead: "L" },
    };
    for (const [name, props] of Object.entries(optionalsDropped)) {
      const widget = BUILTIN_WIDGETS.find((w) => w.name === name);
      if (widget === undefined) throw new Error(`no such widget: ${name}`);
      const parsed = parseBlocks(expand(widget, props));
      if (!parsed.ok) throw new Error(`${name} without its optionals: ${parsed.errors.join("; ")}`);
    }
  });

  it("puts every timeline event in one table rather than a grid each", () => {
    const timeline = BUILTIN_WIDGETS.find((w) => w.name === "timeline");
    if (timeline === undefined) throw new Error("no timeline widget");
    const parsed = parseBlocks(expand(timeline, timeline.example));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const tables = parsed.value.filter((b) => b.kind === "table");
    strictEqual(tables.length, 1);
    // Derived from the example rather than hardcoded: the count is the property
    // under test, and a literal here goes stale the moment the example changes.
    const events = timeline.example["events"];
    strictEqual(tables[0]?.kind === "table" ? tables[0].rows.length : 0, Array.isArray(events) ? events.length : -1);
  });
});
