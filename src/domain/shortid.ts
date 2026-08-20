// The alphabet identifiers are drawn from.
//
// Lowercase base32 minus the characters people confuse: no `0`/`o`, no `1`/`l`/`i`,
// no `u` (which turns short random strings into words often enough to matter).
// Thirty symbols, so each character carries a shade under five bits.
//
// These end up in links that get read aloud, retyped off a screen, and wrapped by
// mail clients, which is the whole reason the set is smaller than base32's.

export const ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";

// 12 characters is about 59 bits. A participant link is a capability -- holding it
// is permission -- so it has to be unguessable rather than merely unique, and 59
// bits is far past what an online guessing attack can cover. It is not a secret
// worth protecting at rest, which is why it is stored as it is.
export const LINK_TOKEN_LENGTH = 12;

// Brief ids are not capabilities: reaching a brief still needs the agent that owns
// it or a link to it. Ten characters is enough to not collide.
export const BRIEF_ID_LENGTH = 10;

// Pure: the caller supplies the randomness. The domain has no entropy source of
// its own, and a function that reached for one could not be tested.
export function encode(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return out;
}
