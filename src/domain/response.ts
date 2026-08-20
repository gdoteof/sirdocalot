// Turning several people's answers into one thing an agent can read.
//
// Coalescing never resolves a disagreement. Two stakeholders answering
// differently is information the agent needs, and picking a winner here would
// throw away the one signal that the question was contested -- by a component
// with none of the context needed to choose. Conflicts are surfaced, labelled,
// and handed over intact.

import type { FieldId, ParticipantId } from "./ids.ts";
import type { Answer, FieldSpec } from "./fields.ts";

export type Response = {
  participantId: ParticipantId;
  submittedAt: string;
  answers: Record<string, Answer>;
};

export type Attribution = { participant: ParticipantId; value: Answer };

export type FieldOutcome = {
  field: FieldSpec;
  answers: Attribution[];
  // True when every respondent who answered gave the same value. A field only one
  // person answered is agreed by this definition, which is the useful reading:
  // there is nothing to reconcile.
  agreed: boolean;
  // Whether differing answers mean anything. Two people writing different prose
  // is what prose does -- calling it a conflict buries the one question where
  // they genuinely diverged under every free-text box on the form.
  contestable: boolean;
  unanswered: ParticipantId[];
};

// A bounded answer space is what makes disagreement legible: two people picked
// different options from the same list. Text has no such space.
const CONTESTABLE_KINDS: readonly FieldSpec["kind"][] = ["choice", "boolean", "rating", "number"];

export type Coalesced = {
  invited: ParticipantId[];
  responded: ParticipantId[];
  outstanding: ParticipantId[];
  fields: FieldOutcome[];
  conflicts: FieldId[];
};

// Comparison is by canonical form so that a multi-choice answer picked in a
// different order is not reported as a disagreement. Order carries no meaning in
// the only field kind that produces arrays.
function canonical(value: Answer): string {
  return Array.isArray(value) ? JSON.stringify([...value].sort()) : JSON.stringify(value);
}

export function coalesce(
  specs: readonly FieldSpec[],
  invited: readonly ParticipantId[],
  responses: readonly Response[],
): Coalesced {
  // Last submission per participant wins. Resubmission is a correction, and the
  // alternative -- keeping both -- would report a person as disagreeing with
  // themselves.
  const latest = new Map<ParticipantId, Response>();
  for (const response of responses) {
    const held = latest.get(response.participantId);
    if (held === undefined || response.submittedAt >= held.submittedAt) {
      latest.set(response.participantId, response);
    }
  }

  const responded = [...latest.keys()];
  const fields: FieldOutcome[] = specs.map((field) => {
    const answers: Attribution[] = [];
    const unanswered: ParticipantId[] = [];
    for (const [participant, response] of latest) {
      const value = response.answers[field.id];
      if (value === undefined) unanswered.push(participant);
      else answers.push({ participant, value });
    }
    const distinct = new Set(answers.map((a) => canonical(a.value)));
    return {
      field,
      answers,
      agreed: distinct.size <= 1,
      contestable: CONTESTABLE_KINDS.includes(field.kind),
      unanswered,
    };
  });

  return {
    invited: [...invited],
    responded,
    outstanding: invited.filter((id) => !latest.has(id)),
    fields,
    conflicts: fields.filter((f) => f.contestable && !f.agreed).map((f) => f.field.id),
  };
}
