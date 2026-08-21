// The surface agents call. JSON in, JSON out, bearer-authenticated.
//
// Responses are shaped for an agent reading them, not for a UI: flat, named by
// field id, and carrying the disagreement explicitly rather than making a caller
// derive it. Tokens spent on the reply are tokens the calling agent pays.

import { Hono } from "hono";
import type { Actor } from "../../domain/agent.ts";
import type { Deps, Renderer } from "../../application/ports.ts";
import { authenticate } from "../../application/authenticate.ts";
import { registerAgent } from "../../application/register-agent.ts";
import { registerAgentSchema, inviteSchema } from "./schemas.ts";
import type { Json } from "../../domain/json.ts";
import { briefId, ID_RULE } from "../../domain/ids.ts";
import { fieldsOf } from "../../domain/primitives.ts";
import { FIELD_COMMON, FIELD_KINDS } from "../../domain/fields.ts";
import type { Coalesced } from "../../domain/response.ts";
import { createBrief } from "../../application/create-brief.ts";
import { closeManually, readResults } from "../../application/read-results.ts";
import { createBriefSchema } from "./schemas.ts";

type Env = { Variables: { actor: Actor } };

export type AgentApiConfig = {
  // The operator's own key. It is not an agent: it mints invite codes and
  // disables agents, which is exactly the authority an agent must not have.
  adminKey: string;
  // Where participants reach this service. Deployment configuration, never stored
  // on a brief -- see docs/DESIGN.md on why the host is not part of an identity.
  baseUrl: string;
  maxAwaitMs: number;
  pollIntervalMs: number;
  linkTtlSeconds: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// A request body can be read once. The auth middleware has to read it to verify
// the signature covers it, so handlers take it from here rather than from the
// stream. Keyed by the Request object and weak, so entries vanish with it.
const bodies = new WeakMap<Request, string>();

async function readJson(c: { req: { raw: Request; text(): Promise<string> } }): Promise<unknown> {
  const cached = bodies.get(c.req.raw);
  const text = cached ?? (await c.req.text());
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function pathWithQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

// Constant time, so a wrong admin key cannot be narrowed by how long the compare
// took. Length is compared first because the loop below needs equal lengths.
function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function pasteLine(baseUrl: string, code: string): string {
  return `Set yourself up on sirdocalot: read ${baseUrl}/start and follow it. My invite code is ${code}`;
}

export function agentApi(deps: Deps, renderers: { artifact: Renderer }, config: AgentApiConfig): Hono<Env> {
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    // Registration is the one route that cannot be authenticated: it is where an
    // agent gets the identity everything else requires. Its gate is the invite
    // code, checked in the use case.
    if (c.req.method === "POST" && c.req.path === "/api/agents") {
      await next();
      return;
    }

    const header = c.req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (presented !== "" && timingEqual(presented, config.adminKey)) {
      c.set("actor", { kind: "admin" });
      await next();
      return;
    }

    const agent = c.req.header("x-sdl-agent");
    if (agent === undefined) {
      return c.json({ error: "unauthorized", hint: `sign your request — see ${config.baseUrl}/start` }, 401);
    }

    // The body is read here and handed to the handlers, because reading it twice
    // is not possible and the signature covers the exact bytes that arrived.
    const body = await c.req.text();
    const outcome = await authenticate(deps, {
      method: c.req.method,
      pathWithQuery: pathWithQuery(c.req.url),
      body,
      agent,
      timestamp: c.req.header("x-sdl-timestamp") ?? "",
      nonce: c.req.header("x-sdl-nonce") ?? "",
      signature: c.req.header("x-sdl-signature") ?? "",
    });
    if (!outcome.ok) return c.json({ error: "unauthorized", reason: outcome.reason }, 401);

    c.set("actor", outcome.actor);
    bodies.set(c.req.raw, body);
    await next();
    return;
  });

  // ------------------------------------------------------------ registration --
  app.post("/agents", async (c) => {
    const parsed = registerAgentSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "bad request", details: parsed.error.issues }, 400);

    const result = await registerAgent(deps, parsed.data);
    if (!result.ok) return c.json({ error: "registration refused", details: result.errors }, 400);

    return c.json(
      {
        agentId: result.value.id,
        name: result.value.name,
        // Said plainly because it is the one thing a caller must not expect us to
        // do for them: we hold no private key and cannot recover one.
        note: "Keep your private key. This service never receives it and cannot reissue it.",
      },
      201,
    );
  });

  // ------------------------------------------------------------------- admin --
  app.post("/invites", async (c) => {
    if (c.get("actor").kind !== "admin") return c.json({ error: "forbidden" }, 403);
    const parsed = inviteSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "bad request", details: parsed.error.issues }, 400);

    const code = `${deps.ids.fresh(4)}-${deps.ids.fresh(4)}-${deps.ids.fresh(4)}`;
    await deps.invites.create(code, parsed.data.note);
    return c.json({ code, paste: pasteLine(config.baseUrl, code) }, 201);
  });

  app.get("/invites", async (c) => {
    if (c.get("actor").kind !== "admin") return c.json({ error: "forbidden" }, 403);
    return c.json({ invites: await deps.invites.list() });
  });

  app.get("/agents", async (c) => {
    if (c.get("actor").kind !== "admin") return c.json({ error: "forbidden" }, 403);
    const agents = await deps.agents.list();
    return c.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt,
        disabled: a.disabledAt !== undefined,
      })),
    });
  });

  app.post("/agents/:id/disable", async (c) => {
    if (c.get("actor").kind !== "admin") return c.json({ error: "forbidden" }, 403);
    await deps.agents.disable(c.req.param("id") as never, deps.clock.now().toISOString());
    return c.json({ disabled: c.req.param("id") });
  });

  app.get("/widgets", async (c) => {
    const widgets = await deps.widgets.list();
    return c.json({
      widgets: widgets.map((w) => ({ name: w.name, summary: w.summary, props: w.props })),
      // Half the vocabulary used to be missing here. Widget props say a question
      // is "a field spec" without saying what one is, so an agent composing a
      // survey had to guess the kinds and the id format -- and guessed wrong on
      // two of three measured generations.
      fields: {
        idRule: ID_RULE,
        common: FIELD_COMMON,
        kinds: Object.entries(FIELD_KINDS).map(([kind, d]) => ({ kind, ...d })),
      },
    });
  });

  app.post("/briefs", async (c) => {
    const parsed = createBriefSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: "bad request", details: parsed.error.issues }, 400);

    const result = await createBrief(deps, c.get("actor"), {
      title: parsed.data.title,
      linkTtlSeconds: config.linkTtlSeconds,
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
    const results = await readResults(deps, c.get("actor"), id.value);
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
      const results = await readResults(deps, c.get("actor"), id.value);
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
    const results = await closeManually(deps, c.get("actor"), id.value);
    if (results === undefined) return c.json({ error: "not found" }, 404);
    return c.json(present(results.brief, results.closed, results.results));
  });

  app.get("/briefs/:id/artifact", async (c) => {
    const id = briefId(c.req.param("id"));
    if (!id.ok) return c.json({ error: "not found" }, 404);
    const results = await readResults(deps, c.get("actor"), id.value);
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
