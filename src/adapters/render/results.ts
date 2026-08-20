// Collected answers as blocks, so results render through exactly the same path as
// everything else. A separate results renderer would be a second place where
// "what a table looks like" is decided.

import type { Coalesced } from "../../domain/response.ts";
import type { Answer } from "../../domain/fields.ts";
import type { PrimitiveBlock } from "../../domain/primitives.ts";
import type { Participant } from "../../domain/brief.ts";

const show = (value: Answer): string => (Array.isArray(value) ? value.join(", ") : String(value));

export function resultBlocks(results: Coalesced, participants: readonly Participant[]): PrimitiveBlock[] {
  const nameOf = (id: string): string => participants.find((p) => p.id === id)?.name ?? id;
  const blocks: PrimitiveBlock[] = [
    { kind: "heading", level: 2, text: "Responses" },
    {
      kind: "keyValue",
      entries: [
        { key: "Responded", value: `${results.responded.length} of ${results.invited.length}` },
        ...(results.outstanding.length > 0
          ? [{ key: "Outstanding", value: results.outstanding.map(nameOf).join(", ") }]
          : []),
        ...(results.conflicts.length > 0
          ? [{ key: "Disagreements", value: results.conflicts.join(", ") }]
          : []),
      ],
    },
  ];

  if (results.conflicts.length > 0) {
    blocks.push({
      kind: "callout",
      tone: "warn",
      title: "Respondents disagree",
      // Stated rather than resolved. Picking a winner here would discard the one
      // signal that the question was contested, and this renderer is the last
      // component with any business making that call.
      text: `${results.conflicts.length} question(s) got different answers from different people. Both are recorded below.`,
    });
  }

  for (const outcome of results.fields) {
    if (outcome.answers.length === 0) continue;
    blocks.push({ kind: "heading", level: 3, text: outcome.field.label });
    blocks.push({
      kind: "table",
      columns: ["Who", "Answer"],
      rows: outcome.answers.map((a) => [nameOf(a.participant), show(a.value)]),
      ...(outcome.contestable && !outcome.agreed ? { caption: "Answers differ." } : {}),
    });
  }

  return blocks;
}
