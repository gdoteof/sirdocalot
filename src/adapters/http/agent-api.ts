// The surface agents call. JSON in, JSON out, bearer-authenticated.
//
// Responses are shaped for an agent reading them, not for a UI: flat, named by
// field id, and carrying the disagreement explicitly rather than making a caller
// derive it. Tokens spent on the reply are tokens the calling agent pays.

import { Hono } from "hono";
import type { Deps, Renderer } from "../../application/ports.ts";
import type { Json } from "../../domain/json.ts";
import { briefId } from "../../domain/ids.ts";
import { fieldsOf } from "../../domain/primitives.ts";
import type { Coalesced } from "../../domain/response.ts";
import { createBrief } from "../../application/create-brief.ts";
import { defineWidget } from "../../application/define-widget.ts";
import { closeManually, readResults } from "../../application/read-results.ts";
import { createBriefSchema, defineWidgetSchema } from "./schemas.ts";

export type AgentApiConfig = {
  agentKey: string;
  // Where participants reach this service. Deployment configuration, never stored
  // on a brief -- see docs/DESIGN.md on why the host is not part of an identity.
  baseUrl: string;
  maxAwaitMs: number;
  pollIntervalMs: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function agentApi(deps: Deps, renderers: { artifact: Renderer }, config: AgentApiConfig): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented !== config.agentKey) return c.json({ error: "unauthorized" }, 401);
    await next();
    return;
  });

  app.get("/widgets", async (c) => {
    const widgets = await deps.widgets.list();
    return c.json({
      widgets: widgets.map((w) => ({
        name: w.name,
        summary: w.summary,
        builtin: w.builtin,
        props: w.props,
      })),
    });
  });

  app.post("/widgets", async (c) => {
    const parsed = defineWidgetSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request", details: parsed.error.issues }, 400);

    // zod hands back `T | undefined` for every optional; the domain types say the
    // key is absent. Dropping the undefined keys is this boundary's job, and it
    // is why the mapping is written out rather than spread.
    const result = await defineWidget(deps, {
      name: parsed.data.name,
      summary: parsed.data.summary,
      props: parsed.data.props.map((p) => ({
        name: p.name,
        type: p.type,
        ...(p.required !== undefined ? { required: p.required } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
      })),
      layout: parsed.data.layout as Json[],
      example: parsed.data.example as Record<string, Json>,
    });
    if (!result.ok) return c.json({ error: "invalid widget", details: result.errors }, 400);
    return c.json({ widget: { name: result.value.name, summary: result.value.summary } }, 201);
  });

  app.post("/briefs", async (c) => {
    const parsed = createBriefSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad request", details: parsed.error.issues }, 400);

    const result = await createBrief(deps, {
      title: parsed.data.title,
      blocks: parsed.data.blocks as Json[],
      participants: parsed.data.participants.map((p) => ({
        name: p.name,
        ...(p.id !== undefined ? { id: p.id } : {}),
        ...(p.role !== undefined ? { role: p.role } : {}),
      })),
      policy: parsed.data.policy,
      intent: {
        purpose: parsed.data.intent.purpose,
        ...(parsed.data.intent.resumeHint !== undefined ? { resumeHint: parsed.data.intent.resumeHint } : {}),
      },
    });
    if (!result.ok) return c.json({ error: "invalid brief", details: result.errors }, 400);

    const { brief, invitations } = result.value;
    return c.json(
      {
        id: brief.id,
        title: brief.title,
        collecting: invitations.length > 0,
        // Inlined only when the brief collects nothing -- there, the rendering is
        // the entire deliverable and a second round trip buys the caller nothing.
        // A collecting brief returns links instead: the page is for participants,
        // and posting several KB of stylesheet into the agent's context to reach
        // it would spend exactly what this service exists to save. GET
        // /api/briefs/:id/artifact serves it on demand.
        ...(invitations.length === 0 ? { artifactHtml: renderers.artifact.render({ brief }) } : {}),
        artifactUrl: `/api/briefs/${brief.id}/artifact`,
        invitations: invitations.map((i) => ({
          participantId: i.participantId,
          name: i.name,
          url: `${config.baseUrl}/r/${i.token}`,
        })),
      },
      201,
    );
  });

  app.get("/briefs/:id", async (c) => {
    const id = briefId(c.req.param("id"));
    if (!id.ok) return c.json({ error: "not found" }, 404);
    const results = await readResults(deps, id.value);
    if (results === undefined) return c.json({ error: "not found" }, 404);
    return c.json(present(results.brief, results.closed, results.results));
  });

  // Long poll. The happy path here is a session that stays alive for hours, so
  // this holds the connection and re-reads rather than asking the caller to
  // schedule its own polling.
  app.get("/briefs/:id/await", async (c) => {
    const id = briefId(c.req.param("id"));
    if (!id.ok) return c.json({ error: "not found" }, 404);

    const requested = Number(c.req.query("timeout_ms") ?? config.maxAwaitMs);
    const budget = Number.isFinite(requested) ? Math.min(Math.max(requested, 0), config.maxAwaitMs) : config.maxAwaitMs;
    const deadline = Date.now() + budget;

    for (;;) {
      const results = await readResults(deps, id.value);
      if (results === undefined) return c.json({ error: "not found" }, 404);
      if (results.closed) return c.json(present(results.brief, true, results.results));
      if (Date.now() >= deadline) {
        // Not an error. A timed-out wait is a legitimate outcome: the caller
        // decides whether to wait again or hand the handle to an orchestrator.
        return c.json({ ...present(results.brief, false, results.results), timedOut: true });
      }
      await sleep(config.pollIntervalMs);
    }
  });

  app.post("/briefs/:id/close", async (c) => {
    const id = briefId(c.req.param("id"));
    if (!id.ok) return c.json({ error: "not found" }, 404);
    const results = await closeManually(deps, id.value);
    if (results === undefined) return c.json({ error: "not found" }, 404);
    return c.json(present(results.brief, results.closed, results.results));
  });

  app.get("/briefs/:id/artifact", async (c) => {
    const id = briefId(c.req.param("id"));
    if (!id.ok) return c.json({ error: "not found" }, 404);
    const results = await readResults(deps, id.value);
    if (results === undefined) return c.json({ error: "not found" }, 404);
    const html = renderers.artifact.render({
      brief: results.brief,
      ...(results.results.responded.length > 0 ? { results: results.results } : {}),
    });
    return c.text(html, 200, { "content-type": "text/html; charset=utf-8" });
  });

  return app;
}

function present(
  brief: Parameters<Renderer["render"]>[0]["brief"],
  closed: boolean,
  results: Coalesced,
): Record<string, unknown> {
  const nameOf = (id: string): string => brief.participants.find((p) => p.id === id)?.name ?? id;

  const answers: Record<string, { agreed: boolean; by: Record<string, unknown> }> = {};
  for (const outcome of results.fields) {
    if (outcome.answers.length === 0) continue;
    answers[outcome.field.id] = {
      agreed: outcome.agreed,
      by: Object.fromEntries(outcome.answers.map((a) => [nameOf(a.participant), a.value])),
    };
  }

  return {
    id: brief.id,
    title: brief.title,
    intent: brief.intent,
    closed,
    closedReason: brief.closedReason ?? null,
    questions: fieldsOf(brief.blocks).map((f) => ({ id: f.id, label: f.label, kind: f.kind })),
    responded: results.responded.map(nameOf),
    outstanding: results.outstanding.map(nameOf),
    // Named separately so a caller does not have to scan every field to discover
    // that its stakeholders disagreed.
    conflicts: results.conflicts,
    answers,
  };
}
