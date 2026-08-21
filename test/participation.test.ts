// A respondent who has answered gets their answers back, not a second chance to
// give them. The failure this guards is quiet: a page that re-offers the form
// looks fine until someone answers twice and wonders which one counted.

import { ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { hostedRenderer } from "../src/adapters/render/hosted.ts";
import type { Brief } from "../src/domain/brief.ts";
import type { FieldSpec } from "../src/domain/fields.ts";
import { briefId, fieldId, participantId } from "../src/domain/ids.ts";
import type { BriefId, FieldId, ParticipantId } from "../src/domain/ids.ts";

const must = <T>(parsed: { ok: true; value: T } | { ok: false; reason: string }): T => {
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
};

const CHOICE: FieldSpec = {
  kind: "choice",
  id: must(fieldId("call")) as FieldId,
  label: "Which one",
  required: true,
  multiple: false,
  options: [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
  ],
};
const NOTE: FieldSpec = { kind: "text", id: must(fieldId("note")) as FieldId, label: "Why", required: false };

const ADA: ParticipantId = must(participantId("p-ada")) as ParticipantId;

const brief: Brief = {
  id: must(briefId("b-one")) as BriefId,
  title: "A decision",
  blocks: [
    { kind: "field", spec: CHOICE },
    { kind: "field", spec: NOTE },
  ],
  participants: [{ id: ADA, name: "Ada" }],
  policy: { closeWhen: { kind: "all" }, visibility: "blind" },
  intent: { purpose: "decide" },
  createdAt: "2026-08-20T00:00:00.000Z",
};

const participant = { id: ADA, name: "Ada" };

describe("a participant who has already answered", () => {
  const html = hostedRenderer().render({
    brief,
    participation: {
      state: "answered",
      participant,
      submittedAt: "2026-08-20T09:30:00.000Z",
      values: { call: "b", note: "Because B is cheaper" },
    },
  });

  it("is not offered the form again", () => {
    strictEqual(html.includes("<form"), false);
    strictEqual(html.includes('type="submit"'), false);
  });

  it("sees the answers it recorded", () => {
    ok(html.includes("Because B is cheaper"), "free text is missing");
    ok(html.includes('value="b" checked'), "the chosen option is not marked");
  });

  it("cannot change them", () => {
    // Every control disabled, so a refresh is a reading and not a second attempt.
    const controls = html.match(/<input[^>]*>|<textarea[^>]*>/g) ?? [];
    ok(controls.length > 0, "no controls rendered at all");
    strictEqual(
      controls.filter((c) => !c.includes("disabled")).length,
      0,
      "some control is still editable",
    );
  });

  it("says who answered and when", () => {
    ok(html.includes("Answered by Ada"), "no attribution");
    ok(html.includes("20 August 2026"), "no date");
  });
});

describe("a participant who has not answered", () => {
  const html = hostedRenderer().render({
    brief,
    participation: { state: "answering", participant, action: "/r/tok", errors: {}, values: {} },
  });

  it("gets a working form", () => {
    ok(html.includes('<form method="post" action="/r/tok"'), "no form");
    ok(html.includes('type="submit"'), "no submit");
    // Scoped to the controls: the stylesheet mentions `disabled` too, and a bare
    // substring check would pass or fail on the CSS rather than on the form.
    const controls = html.match(/<input[^>]*>|<textarea[^>]*>/g) ?? [];
    ok(controls.length > 0, "no controls rendered at all");
    strictEqual(controls.filter((c) => c.includes("disabled")).length, 0, "controls arrived disabled");
  });
});
