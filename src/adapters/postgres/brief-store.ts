import type { Brief, Intent, Participant } from "../../domain/brief.ts";
import type { BriefId } from "../../domain/ids.ts";
import type { CloseReason, CollectionPolicy } from "../../domain/policy.ts";
import type { PrimitiveBlock } from "../../domain/primitives.ts";
import type { Response } from "../../domain/response.ts";
import type { BriefStore } from "../../application/ports.ts";
import type { Db } from "./pool.ts";

type BriefRow = {
  id: string;
  title: string;
  blocks: PrimitiveBlock[];
  participants: Participant[];
  policy: CollectionPolicy;
  intent: Intent;
  created_at: Date;
  closed_at: Date | null;
  closed_reason: string | null;
};

type ResponseRow = {
  participant_id: string;
  submitted_at: Date;
  answers: Record<string, string | number | boolean | string[]>;
};

// The jsonb columns are read back as the types they were written as. That is a
// claim about this table having exactly one writer -- the create path, which
// parses first -- and not a general licence to trust stored JSON. If a second
// writer ever appears, this is the assumption that breaks.
export function briefStore(db: Db): BriefStore {
  return {
    async create(brief: Brief): Promise<void> {
      await db.query(
        `insert into briefs (id, title, blocks, participants, policy, intent, created_at, closed_at, closed_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          brief.id,
          brief.title,
          JSON.stringify(brief.blocks),
          JSON.stringify(brief.participants),
          JSON.stringify(brief.policy),
          JSON.stringify(brief.intent),
          brief.createdAt,
          brief.closedAt ?? null,
          brief.closedReason ?? null,
        ],
      );
    },

    async get(id: BriefId): Promise<Brief | undefined> {
      const { rows } = await db.query<BriefRow>("select * from briefs where id = $1", [id]);
      const row = rows[0];
      if (row === undefined) return undefined;
      return {
        id: row.id as BriefId,
        title: row.title,
        blocks: row.blocks,
        participants: row.participants,
        policy: row.policy,
        intent: row.intent,
        createdAt: row.created_at.toISOString(),
        ...(row.closed_at !== null ? { closedAt: row.closed_at.toISOString() } : {}),
        ...(row.closed_reason !== null ? { closedReason: row.closed_reason as CloseReason } : {}),
      };
    },

    async close(id: BriefId, at: string, reason: CloseReason): Promise<void> {
      // `closed_at is null` makes this idempotent under a race: two readers can
      // both decide a deadline has passed, and the second must not overwrite the
      // first one's reason or timestamp.
      await db.query("update briefs set closed_at = $2, closed_reason = $3 where id = $1 and closed_at is null", [
        id,
        at,
        reason,
      ]);
    },

    async recordResponse(id: BriefId, response: Response): Promise<void> {
      await db.query(
        "insert into responses (brief_id, participant_id, submitted_at, answers) values ($1, $2, $3, $4)",
        [id, response.participantId, response.submittedAt, JSON.stringify(response.answers)],
      );
    },

    async responsesOf(id: BriefId): Promise<Response[]> {
      const { rows } = await db.query<ResponseRow>(
        "select participant_id, submitted_at, answers from responses where brief_id = $1 order by submitted_at asc",
        [id],
      );
      return rows.map((row) => ({
        participantId: row.participant_id as Response["participantId"],
        submittedAt: row.submitted_at.toISOString(),
        answers: row.answers,
      }));
    },
  };
}
