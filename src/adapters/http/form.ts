// Form values are all strings. Turning them back into answers needs the field
// specs, so it happens here, at the HTTP edge, and the domain only ever sees
// values already in their proper type.

import type { Answer, FieldSpec } from "../../domain/fields.ts";

type Raw = Record<string, string | File | (string | File)[]>;

const asStrings = (value: string | File | (string | File)[] | undefined): string[] => {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((v): v is string => typeof v === "string").filter((v) => v !== "");
};

export function formToAnswers(specs: readonly FieldSpec[], raw: Raw): Record<string, Answer> {
  const answers: Record<string, Answer> = {};

  for (const spec of specs) {
    const values = asStrings(raw[spec.id]);

    // An unchecked box and an untouched field both submit nothing. Omitting them
    // lets the domain apply its own required/optional rules rather than having
    // this layer invent an empty value that then fails a different check.
    if (values.length === 0) {
      if (spec.kind === "boolean") answers[spec.id] = false;
      continue;
    }

    switch (spec.kind) {
      case "text":
        answers[spec.id] = values[0] ?? "";
        break;
      case "number":
      case "rating": {
        const parsed = Number(values[0]);
        // Non-numeric text in a number box is left as the string it was, so the
        // domain reports "expected a number" against the field the user sees
        // rather than this layer silently substituting NaN or zero.
        answers[spec.id] = Number.isFinite(parsed) ? parsed : (values[0] ?? "");
        break;
      }
      case "boolean":
        answers[spec.id] = values[0] === "true";
        break;
      case "choice":
        answers[spec.id] = spec.multiple ? values : (values[0] ?? "");
        break;
    }
  }

  return answers;
}
