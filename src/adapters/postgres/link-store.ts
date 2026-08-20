import type { BriefId, ParticipantId } from "../../domain/ids.ts";
import { LINK_TOKEN_LENGTH } from "../../domain/shortid.ts";
import type { IdSource, ParticipantLinks } from "../../application/ports.ts";
import type { Db } from "./pool.ts";

export function linkStore(db: Db, ids: IdSource): ParticipantLinks {
  return {
    async issue(briefId: BriefId, participantId: ParticipantId, expiresAt: Date): Promise<string> {
      // Retry on collision rather than trusting 59 bits blindly. It will
      // effectively never fire, and the alternative is a primary-key violation
      // surfacing to a stakeholder as a failed brief creation.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const token = ids.fresh(LINK_TOKEN_LENGTH);
        const result = await db.query(
          `insert into participant_links (token, brief_id, participant_id, expires_at)
           values ($1, $2, $3, $4) on conflict (token) do nothing`,
          [token, briefId, participantId, expiresAt],
        );
        if ((result.rowCount ?? 0) === 1) return token;
      }
      throw new Error("could not issue a unique participant link");
    },

    async resolve(
      token: string,
      now: Date,
    ): Promise<{ briefId: BriefId; participantId: ParticipantId } | undefined> {
      // Expiry and revocation are checked in the query rather than after it, so
      // there is no window where code forgets to apply them.
      const { rows } = await db.query<{ brief_id: string; participant_id: string }>(
        `select brief_id, participant_id from participant_links
         where token = $1 and revoked_at is null and expires_at > $2`,
        [token, now],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      return { briefId: row.brief_id as BriefId, participantId: row.participant_id as ParticipantId };
    },
  };
}
