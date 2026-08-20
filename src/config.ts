// Environment, read once, at the edge, and refused loudly.
//
// A missing secret is not a request that fails; it is a precondition for serving
// this kind of work at all. So it is a start-up failure, not a 500 discovered by
// whichever stakeholder happened to click first.

export type Config = {
  port: number;
  databaseUrl: string;
  databaseSchema: string;
  adminKey: string;
  baseUrl: string;
  linkTtlSeconds: number;
  maxAwaitMs: number;
  pollIntervalMs: number;
  notifyWebhook?: string;
};

function required(env: NodeJS.ProcessEnv, name: string, missing: string[]): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    missing.push(name);
    return "";
  }
  return value;
}

function number(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const config: Config = {
    port: number(env, "PORT", 8080),
    databaseUrl: required(env, "DATABASE_URL", missing),
    // Its own schema on a shared server. The database is sirdocalot's alone and
    // so is the schema inside it -- reusing the Postgres instance is a cost
    // decision about a development cluster, not a decision to mingle tables.
    databaseSchema: env["DATABASE_SCHEMA"] ?? "sirdocalot",
    // The operator's key. Agents authenticate with their own keypairs and never
    // hold this one -- it mints invite codes and disables agents.
    adminKey: required(env, "AGENT_KEY", missing),
    // Where participants reach this service. Deliberately configuration and not
    // something a brief remembers: the same brief served from a different host
    // is still the same brief, which is what keeps "move this somewhere shared"
    // a config change rather than a migration.
    baseUrl: (env["BASE_URL"] ?? `http://localhost:${number(env, "PORT", 8080)}`).replace(/\/+$/, ""),
    linkTtlSeconds: number(env, "LINK_TTL_HOURS", 24 * 14) * 3600,
    maxAwaitMs: number(env, "MAX_AWAIT_MS", 5 * 60 * 1000),
    pollIntervalMs: number(env, "POLL_INTERVAL_MS", 2000),
    ...(env["NOTIFY_WEBHOOK"] !== undefined && env["NOTIFY_WEBHOOK"] !== ""
      ? { notifyWebhook: env["NOTIFY_WEBHOOK"] }
      : {}),
  };

  if (missing.length > 0) {
    throw new Error(
      `missing required environment: ${missing.join(", ")}. ` +
        `See README.md — docker compose supplies development values for all of them.`,
    );
  }
  return config;
}
