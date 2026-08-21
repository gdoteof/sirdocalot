// What a stakeholder opens. No authentication beyond the link itself, no
// JavaScript, and no account. A form that needs any of those is a form some
// respondent will not complete.

import { Hono } from "hono";
import type { Deps, Renderer } from "../../application/ports.ts";
import type { Answer } from "../../domain/fields.ts";
import { fieldsOf } from "../../domain/primitives.ts";
import { isClosed, participantOf } from "../../domain/brief.ts";
import { recordResponse } from "../../application/record-response.ts";
import { formToAnswers } from "./form.ts";

export function participantApp(deps: Deps, renderer: Renderer): Hono {
  const app = new Hono();

  app.get("/r/:token", async (c) => {
    const token = c.req.param("token");
    const claim = await deps.links.resolve(token, deps.clock.now());
    if (claim === undefined) return c.html(gone("This link is not valid, or it has expired."), 404);

    const brief = await deps.briefs.get(claim.briefId);
    if (brief === undefined) return c.html(gone("This brief no longer exists."), 404);

    const participant = participantOf(brief, claim.participantId);
    if (participant === undefined) return c.html(gone("This link is not for a participant of this brief."), 403);

    // What they said last time, if anything. A respondent who reopens their link
    // is usually checking what they submitted, and a page that answers that with
    // an empty form invites them to answer twice.
    const mine = (await deps.briefs.responsesOf(brief.id)).find((r) => r.participantId === participant.id);

    if (mine !== undefined) {
      return c.html(
        renderer.render({
          brief,
          participation: { state: "answered", participant, submittedAt: mine.submittedAt, values: mine.answers },
          banner: isClosed(brief)
            ? { title: "Collection has closed", body: "Your answers are below, as they were recorded." }
            : { title: "You have answered", body: "Your answers are below. There is nothing further to do." },
        }),
      );
    }

    if (isClosed(brief)) {
      return c.html(
        renderer.render({
          brief,
          banner: { title: "Collection has closed", body: "This brief is no longer accepting answers." },
        }),
      );
    }

    return c.html(
      renderer.render({
        brief,
        participation: { state: "answering", participant, action: `/r/${token}`, errors: {}, values: {} },
      }),
    );
  });

  app.post("/r/:token", async (c) => {
    const token = c.req.param("token");
    const claim = await deps.links.resolve(token, deps.clock.now());
    if (claim === undefined) return c.html(gone("This link is not valid, or it has expired."), 404);

    const brief = await deps.briefs.get(claim.briefId);
    if (brief === undefined) return c.html(gone("This brief no longer exists."), 404);

    const raw = await c.req.parseBody({ all: true });
    const answers: Record<string, Answer> = formToAnswers(fieldsOf(brief.blocks), raw);
    const outcome = await recordResponse(deps, token, answers);

    if (outcome.ok) {
      // Read back what was stored rather than echoing what was posted: if the
      // two ever differ, the page should show what the agent will actually see.
      const stored = (await deps.briefs.responsesOf(outcome.brief.id)).find(
        (r) => r.participantId === claim.participantId,
      );
      const participant = participantOf(outcome.brief, claim.participantId);
      const banner = {
        title: "Answers recorded",
        body: outcome.closed
          ? "That was the last response needed. The agent has what it asked for."
          : "Your answers are below. You can close this page.",
      };
      return c.html(
        renderer.render(
          stored === undefined || participant === undefined
            ? { brief: outcome.brief, banner }
            : {
                brief: outcome.brief,
                participation: {
                  state: "answered",
                  participant,
                  submittedAt: stored.submittedAt,
                  values: stored.answers,
                },
                banner,
              },
        ),
      );
    }

    if (outcome.kind === "rejected") {
      return c.html(
        renderer.render({ brief, banner: { title: "Not accepted", body: outcome.reason } }),
        409,
      );
    }

    // Re-render with what they typed still in place. Losing a long answer to a
    // validation error is how a respondent stops being one.
    const participant = participantOf(brief, claim.participantId);
    const errors = Object.fromEntries(outcome.fieldErrors.map((e) => [e.field, e.reason]));
    return c.html(
      participant === undefined
        ? gone("This link is not for a participant of this brief.")
        : renderer.render({
            brief,
            participation: { state: "answering", participant, action: `/r/${token}`, errors, values: answers },
            banner: { title: "Not submitted", body: "Some answers need attention before this can be recorded." },
          }),
      400,
    );
  });

  return app;
}

// Deliberately plain: a dead or wrong link should say so without leaking whether
// the brief exists, who is on it, or what it asked.
function gone(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" /><title>Unavailable</title>
<style>
  body { margin:0; display:grid; place-items:center; min-height:100vh; background:#fbfaf8; color:#1c1b1a;
         font:16px/1.6 ui-sans-serif, system-ui, sans-serif; }
  @media (prefers-color-scheme: dark) { body { background:#17161a; color:#eceaf0; } }
  main { max-width:26rem; padding:2rem; text-align:center; }
  h1 { font-size:1.15rem; margin:0 0 .5rem; }
  p { margin:0; opacity:.7; }
</style></head>
<body><main><h1>Unavailable</h1><p>${message.replace(/</g, "&lt;")}</p></main></body></html>`;
}
