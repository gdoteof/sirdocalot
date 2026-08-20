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

function number(env: NodeJS.ProcessEnv, name: string, fallback: number, bad: string[]): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  // Refused rather than defaulted. Setting MAX_AWAIT_MS=90s and silently getting
  // the default back is the kind of misconfiguration that is only discovered by
  // the behaviour not changing, in a loader whose whole posture is failing loudly.
  if (!Number.isFinite(parsed)) {
    bad.push(`${name}=${raw} (expected a number)`);
    return fallback;
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing: string[] = [];
  const bad: string[] = [];
  const config: Config = {
    port: number(env, "PORT", 8080, bad),
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
    baseUrl: (env["BASE_URL"] ?? `http://localhost:${number(env, "PORT", 8080, bad)}`).replace(/\/+$/, ""),
    linkTtlSeconds: number(env, "LINK_TTL_HOURS", 24 * 14, bad) * 3600,
    // Ninety seconds, and the number is measured rather than chosen. Cloudflare
    // gives an origin about 100s to respond before returning 524; a 150s poll
    // through the tunnel died at 125s with error 524 and no body. Holding a
    // connection past that ceiling does not make the caller wait longer, it makes
    // the wait fail. So each poll returns inside the window with timedOut: true,
    // and a caller that wants to wait longer calls again -- which the MCP client
    // does on the caller's behalf.
    maxAwaitMs: number(env, "MAX_AWAIT_MS", 90 * 1000, bad),
    pollIntervalMs: number(env, "POLL_INTERVAL_MS", 2000, bad),
    ...(env["NOTIFY_WEBHOOK"] !== undefined && env["NOTIFY_WEBHOOK"] !== ""
      ? { notifyWebhook: env["NOTIFY_WEBHOOK"] }
      : {}),
  };

  if (bad.length > 0) {
    throw new Error(`unusable environment: ${bad.join(", ")}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `missing required environment: ${missing.join(", ")}. ` +
        `See README.md — docker compose supplies development values for all of them.`,
    );
  }
  return config;
}
