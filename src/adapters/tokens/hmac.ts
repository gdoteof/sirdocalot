// Participant tokens: signed, expiring, one per person.
//
// This is a capability, not a credential. Whoever holds the link may answer as
// that participant, and a forwarded link is a forwarded identity. That trade is
// deliberate and recorded in docs/DESIGN.md -- it buys links that work for people
// with no account, which is the whole point of sending one to a stakeholder.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { BriefId, ParticipantId } from "../../domain/ids.ts";
import { briefId, participantId } from "../../domain/ids.ts";
import type { ParticipantTokens } from "../../application/ports.ts";

type Payload = { b: string; p: string; exp: number };

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function hmacTokens(secret: string, ttlSeconds: number, now: () => Date): ParticipantTokens {
  const sign = (body: string): string => b64url(createHmac("sha256", secret).update(body).digest());

  return {
    mint(brief: BriefId, participant: ParticipantId): string {
      const payload: Payload = {
        b: brief,
        p: participant,
        exp: Math.floor(now().getTime() / 1000) + ttlSeconds,
      };
      const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
      return `${body}.${sign(body)}`;
    },

    verify(token: string): { briefId: BriefId; participantId: ParticipantId } | undefined {
      const [body, signature] = token.split(".");
      if (body === undefined || signature === undefined) return undefined;

      const expected = Buffer.from(sign(body), "utf8");
      const actual = Buffer.from(signature, "utf8");
      // Length check first: timingSafeEqual throws on a length mismatch, and a
      // thrown comparison is a comparison that leaked the length anyway.
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;

      let payload: Payload;
      try {
        payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
      } catch {
        return undefined;
      }
      if (typeof payload.exp !== "number" || payload.exp * 1000 < now().getTime()) return undefined;

      const brief = briefId(String(payload.b));
      const participant = participantId(String(payload.p));
      if (!brief.ok || !participant.ok) return undefined;
      return { briefId: brief.value, participantId: participant.value };
    },
  };
}
