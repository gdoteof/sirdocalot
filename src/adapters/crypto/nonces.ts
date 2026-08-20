// Replay guard.
//
// A signature is valid for its whole freshness window, so without this a captured
// request can be sent again inside that window. Remembering every nonce seen in
// the last window closes it.
//
// IN MEMORY, AND THAT IS A CHOICE ABOUT ONE REPLICA. This deployment runs a single
// pod with a Recreate strategy, so there is exactly one memory to be in. Under two
// replicas a nonce burned on one would be unknown to the other and replay would
// work again -- at which point this moves to Postgres or Redis. The moment
// `replicas` changes, this is the thing that has to change with it.

import type { Nonces } from "../../application/ports.ts";
import { FRESHNESS_WINDOW_SECONDS } from "../../domain/agent.ts";

export function memoryNonces(): Nonces {
  const seen = new Map<string, number>();
  // Twice the window, so a nonce cannot be forgotten while a signature bearing it
  // is still fresh.
  const retainMs = FRESHNESS_WINDOW_SECONDS * 2 * 1000;

  return {
    claim(nonce: string, now: Date): boolean {
      const nowMs = now.getTime();
      // Swept on use rather than on a timer: nothing to shut down cleanly, and the
      // work is proportional to traffic instead of to wall-clock time.
      for (const [key, at] of seen) {
        if (nowMs - at > retainMs) seen.delete(key);
      }
      if (seen.has(nonce)) return false;
      seen.set(nonce, nowMs);
      return true;
    },
  };
}
