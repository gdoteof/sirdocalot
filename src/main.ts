// The composition root: the one place that knows every adapter exists.
//
// Nothing inward of here names an implementation, which is what makes the two
// render targets interchangeable and the stores swappable in tests.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.ts";
import type { Deps } from "./application/ports.ts";
import { randomIds, systemClock } from "./adapters/clock.ts";
import { ed25519 } from "./adapters/crypto/ed25519.ts";
import { memoryNonces } from "./adapters/crypto/nonces.ts";
import { connect, migrate } from "./adapters/postgres/pool.ts";
import { briefStore } from "./adapters/postgres/brief-store.ts";
import { agentStore, inviteCodes } from "./adapters/postgres/agent-store.ts";
import { linkStore } from "./adapters/postgres/link-store.ts";
import { seedBuiltins, widgetStore } from "./adapters/postgres/widget-store.ts";
import { loggingNotifier, webhookNotifier } from "./adapters/notify/webhook.ts";
import { artifactRenderer } from "./adapters/render/artifact.ts";
import { hostedRenderer } from "./adapters/render/hosted.ts";
import { agentApi } from "./adapters/http/agent-api.ts";
import { participantApp } from "./adapters/http/participant-app.ts";
import { onboarding } from "./adapters/http/onboarding.ts";

const config = loadConfig();
const db = connect(config.databaseUrl, config.databaseSchema);

const ran = await migrate(db, config.databaseSchema);
if (ran.length > 0) console.log(JSON.stringify({ event: "migrated", schema: config.databaseSchema, files: ran }));

const widgets = widgetStore(db);
const seeded = await seedBuiltins(widgets);

const deps: Deps = {
  briefs: briefStore(db),
  widgets,
  agents: agentStore(db),
  invites: inviteCodes(db),
  links: linkStore(db, randomIds),
  clock: systemClock,
  ids: randomIds,
  signatures: ed25519(),
  nonces: memoryNonces(),
  notifier:
    config.notifyWebhook !== undefined
      ? webhookNotifier(config.notifyWebhook, loggingNotifier())
      : loggingNotifier(),
};

const app = new Hono();

app.get("/healthz", async (c) => {
  // Readiness, not liveness: a process that cannot reach Postgres serves nothing
  // useful, and reporting healthy would keep it in rotation.
  try {
    await db.query("select 1");
    return c.json({ ok: true });
  } catch (error: unknown) {
    return c.json({ ok: false, error: String(error) }, 503);
  }
});

app.route(
  "/api",
  agentApi(
    deps,
    { artifact: artifactRenderer() },
    {
      adminKey: config.adminKey,
      baseUrl: config.baseUrl,
      maxAwaitMs: config.maxAwaitMs,
      pollIntervalMs: config.pollIntervalMs,
      linkTtlSeconds: config.linkTtlSeconds,
    },
  ),
);
app.route("/", onboarding(config.baseUrl));
app.route("/", participantApp(deps, hostedRenderer()));

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    JSON.stringify({ event: "listening", port: info.port, baseUrl: config.baseUrl, builtinWidgets: seeded }),
  );
});

// k8s sends SIGTERM and waits. Draining in-flight requests matters more here than
// in most services: a long poll can be holding a connection for minutes, and
// killing it looks to the caller like the brief vanished.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(JSON.stringify({ event: "shutting-down", signal }));
    server.close(() => {
      void db.end().then(() => process.exit(0));
    });
  });
}
