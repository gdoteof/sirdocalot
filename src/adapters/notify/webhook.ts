// The collection-closed signal.
//
// This is the whole of the service's involvement in resumption: it says a brief
// finished and to whom it belonged. What happens next -- waking a session,
// queueing work, mailing someone -- belongs to whatever orchestrator owns the
// agent, and putting any of it here would make this service responsible for a
// lifecycle it cannot see.

import type { Brief, Notifier } from "../../application/ports.ts";
import type { CloseReason } from "../../domain/policy.ts";

export function loggingNotifier(): Notifier {
  return {
    async collectionClosed(brief: Brief, reason: CloseReason): Promise<void> {
      console.log(
        JSON.stringify({
          event: "collection.closed",
          briefId: brief.id,
          title: brief.title,
          reason,
          intent: brief.intent,
        }),
      );
    },
  };
}

export function webhookNotifier(url: string, fallback: Notifier): Notifier {
  return {
    async collectionClosed(brief: Brief, reason: CloseReason): Promise<void> {
      await fallback.collectionClosed(brief, reason);
      try {
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: "collection.closed",
            briefId: brief.id,
            title: brief.title,
            reason,
            intent: brief.intent,
          }),
        });
      } catch (error: unknown) {
        // A failed notification must not fail the submission that triggered it.
        // The responder did their part; the brief is closed either way, and a
        // caller polling the handle still finds out.
        console.error(JSON.stringify({ event: "notify.failed", briefId: brief.id, error: String(error) }));
      }
    },
  };
}
