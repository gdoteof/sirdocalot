// The clock and the randomness, in one place, at the edge. Everything inward of
// here takes them as arguments.

import { randomBytes } from "node:crypto";
import type { Clock, IdSource } from "../application/ports.ts";

export const systemClock: Clock = { now: () => new Date() };

// Hex rather than base64url: brief ids appear in URLs and in the branded-id slug
// shape, which is lowercase alphanumeric. 12 bytes is 96 bits, which is not a
// secret -- the participant token is -- but is far past accidental collision.
export const randomIds: IdSource = { fresh: () => randomBytes(12).toString("hex") };
