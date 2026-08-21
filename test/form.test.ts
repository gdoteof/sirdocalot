// A form is where a person's answer becomes an answer, and the failure that
// matters here is silent: a value nobody entered arriving as though they had.

import { deepStrictEqual, strictEqual, ok } from "node:assert/strict";
import { describe, it } from "node:test";

import { formToAnswers } from "../src/adapters/http/form.ts";
import { FIELD_KINDS, validateAnswers } from "../src/domain/fields.ts";
import { parseFieldSpec } from "../src/domain/parse.ts";
import type { Json } from "../src/domain/json.ts";
import type { FieldSpec } from "../src/domain/fields.ts";
import type { FieldId } from "../src/domain/ids.ts";
import { fieldId } from "../src/domain/ids.ts";
import { renderBlocks } from "../src/adapters/render/blocks.ts";

const fid = (s: string): FieldId => {
  const parsed = fieldId(s);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
};

describe("boolean answers", () => {
  const agree: FieldSpec = { kind: "boolean", id: fid("agree"), label: "Agree", required: true };

  // The original rendering was a single "Yes" checkbox, and an unticked box was
  // read as false. So a required question could be answered only one way, and
  // skipping it recorded a "no" nobody had given.
  it("treats an untouched boolean as unanswered rather than as no", () => {
    const answers = formToAnswers([agree], {});
    deepStrictEqual(answers, {});
    strictEqual(validateAnswers([agree], answers).length, 1);
  });

  it("records both answers", () => {
    deepStrictEqual(formToAnswers([agree], { agree: "true" }), { agree: true });
    deepStrictEqual(formToAnswers([agree], { agree: "false" }), { agree: false });
  });

  it("accepts an omitted optional boolean", () => {
    const optional: FieldSpec = { ...agree, required: false };
    strictEqual(validateAnswers([optional], formToAnswers([optional], {})).length, 0);
  });

  // The parsing above only works because both answers are reachable on the page.
  it("offers no as well as yes", () => {
    const html = renderBlocks([{ kind: "field", spec: agree }], {
      values: {},
      errors: {},
      interactive: true,
    });
    ok(html.includes('value="true"'), "no yes option");
    ok(html.includes('value="false"'), "no no option");
    ok(!html.includes('type="checkbox"'), "still a checkbox, which cannot express no");
  });
});

// The vocabulary /api/widgets publishes has to be the vocabulary the parser
// accepts. It was not: widget props described a question as "a field spec"
// without saying what one is, and agents filled the gap with kinds that do not
// exist. A published set that drifts from the validator is the same bug wearing
// a different hat, so the two are checked against each other here.
describe("the published field vocabulary", () => {
  const sample: Record<string, Record<string, Json>> = {
    text: { long: true },
    number: { min: 0 },
    boolean: {},
    choice: { options: [{ value: "a", label: "A" }], multiple: false },
    rating: { scale: 5 },
  };

  for (const kind of Object.keys(FIELD_KINDS)) {
    it(`accepts the published kind "${kind}"`, () => {
      const ctx = { errors: [] as string[] };
      const spec = parseFieldSpec({ kind, id: "a-field", label: "A field", required: true, ...sample[kind] }, "spec", ctx);
      strictEqual(ctx.errors.join("; "), "", "published kind was refused");
      ok(spec !== undefined);
    });
  }

  it("refuses a kind it does not publish", () => {
    const ctx = { errors: [] as string[] };
    parseFieldSpec({ kind: "textarea", id: "a-field", label: "A", required: true }, "spec", ctx);
    strictEqual(ctx.errors.length > 0, true);
  });

  // Both real generations that failed used snake_case, and so did the first
  // brief written by hand in this repository.
  it("says what a valid id looks like when it refuses one", () => {
    const parsed = fieldId("max_await_ms");
    strictEqual(parsed.ok, false);
    ok(!parsed.ok && parsed.reason.includes("max-await-ms"), "rejection does not show the shape");
  });
});
