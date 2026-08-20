// The clock and the randomness, in one place, at the edge. Everything inward of
// here takes them as arguments.

import { randomBytes } from "node:crypto";
import type { Clock, IdSource } from "../application/ports.ts";
import { encode, LINK_TOKEN_LENGTH } from "../domain/shortid.ts";

export const systemClock: Clock = { now: () => new Date() };

// The randomness lives here; the alphabet and the encoding live in the domain,
// which has no entropy source of its own and could not be tested if it did.
//
// One random byte per output character, reduced modulo a 30-symbol alphabet. The
// bias that introduces is under a quarter of a bit per character and irrelevant
// at this length -- 12 characters is still ~59 bits against a guesser, which is
// far past what an online attack can cover.
export const randomIds: IdSource = {
  fresh: (length = LINK_TOKEN_LENGTH) => encode(randomBytes(length), length),
};
