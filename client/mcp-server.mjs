#!/usr/bin/env node
// An MCP server for sirdocalot: a thin wrapper over the HTTP API at
// SIRDOCALOT_URL, speaking JSON-RPC 2.0 over stdio.
//
// Node built-ins only, one file, no build step. It is meant to be read before it
// is run, so it stays flat: credentials, signing, the HTTP call, the tool table,
// then the protocol loop.
//
//   SIRDOCALOT_URL   base URL of the service   (default: whichever instance served this file)
//   SIRDOCALOT_HOME  credentials directory     (default ~/.sirdocalot)
//
// The credentials directory holds `key.pem`, an Ed25519 private key, and `agent`,
// a text file with the agent id. Get both from <SIRDOCALOT_URL>/start. The
// private key is used here to sign requests and is never sent anywhere.

import { createInterface } from "node:readline";
import { createHash, createPrivateKey, randomBytes, sign as signBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// __BASE__ is substituted by the instance serving this file, so a client
// downloaded from your own deployment defaults to your own deployment. Running
// it straight from a checkout leaves the placeholder, which is why that case
// falls back to localhost rather than to somebody else's host: signing requests
// to a server that has never seen your key fails as "unauthorized", which reads
// like a broken signature rather than the wrong address.
const SERVED_BASE = "__BASE__";
const DEFAULT_BASE = SERVED_BASE.startsWith("http") ? SERVED_BASE : "http://localhost:8080";
const BASE_URL = (process.env.SIRDOCALOT_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
const CRED_DIR = process.env.SIRDOCALOT_HOME ?? join(homedir(), ".sirdocalot");

const SERVER_INFO = { name: "sirdocalot", version: "0.3.0" };
const FALLBACK_PROTOCOL_VERSION = "2025-06-18";

// stdout carries the protocol and nothing else. One stray character corrupts the
// stream for good, so every diagnostic goes here instead.
function log(...parts) {
  process.stderr.write(`[sirdocalot] ${parts.join(" ")}\n`);
}

// ---------------------------------------------------------------- credentials --

let cachedCredentials = null;

// Re-read until a successful load, so an operator who runs through /start after
// the MCP connection is already up does not have to restart the server. Once the
// files have been read successfully they are kept: they do not change under us.
function credentials() {
  if (cachedCredentials !== null) return cachedCredentials;

  const keyPath = join(CRED_DIR, "key.pem");
  const agentPath = join(CRED_DIR, "agent");
  try {
    const key = createPrivateKey(readFileSync(keyPath, "utf8"));
    const agent = readFileSync(agentPath, "utf8").trim();
    if (agent === "") return { ok: false, reason: `${agentPath} is empty` };
    cachedCredentials = { ok: true, key, agent };
    return cachedCredentials;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function setupMessage(reason) {
  return [
    `No usable sirdocalot credentials in ${CRED_DIR} (${reason}).`,
    `Ask the operator to visit ${BASE_URL}/start and follow it: it writes ${join(CRED_DIR, "key.pem")}`,
    `and ${join(CRED_DIR, "agent")}. Nothing here works until those two files exist.`,
  ].join(" ");
}

// -------------------------------------------------------------------- signing --

// The server rebuilds this exact string and verifies the signature over it, so
// every part has to match byte for byte: uppercase method, path *with* query
// string, whole seconds, and the digest of the body actually sent (the digest of
// the empty string when there is none).
function canonicalRequest(method, pathWithQuery, timestamp, body) {
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return [method.toUpperCase(), pathWithQuery, timestamp, digest].join("\n");
}

async function api(method, pathWithQuery, body, timeoutMs = 30_000) {
  const creds = credentials();
  if (!creds.ok) return { ok: false, text: setupMessage(creds.reason) };

  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonical = canonicalRequest(method, pathWithQuery, timestamp, payload);

  // Ed25519 takes null as the algorithm: the hash is part of the scheme, so
  // there is no digest to name.
  const signature = signBytes(null, Buffer.from(canonical, "utf8"), creds.key).toString("base64");

  const headers = {
    "x-sdl-agent": creds.agent,
    "x-sdl-timestamp": timestamp,
    // Fresh per request. The server accepts a nonce once, so a reused one is
    // refused as a replay rather than served.
    "x-sdl-nonce": randomBytes(12).toString("hex"),
    "x-sdl-signature": signature,
  };
  if (body !== undefined) headers["content-type"] = "application/json";

  let response;
  try {
    response = await fetch(`${BASE_URL}${pathWithQuery}`, {
      method: method.toUpperCase(),
      headers,
      ...(body === undefined ? {} : { body: payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, text: `Could not reach ${BASE_URL}${pathWithQuery} — ${reason}` };
  }

  const text = await response.text();
  if (!response.ok) {
    return { ok: false, text: `${method.toUpperCase()} ${pathWithQuery} failed: HTTP ${response.status}. ${text}` };
  }
  return { ok: true, text, status: response.status };
}

async function apiJson(method, pathWithQuery, body, timeoutMs) {
  const result = await api(method, pathWithQuery, body, timeoutMs);
  if (!result.ok) return result;
  try {
    return { ok: true, data: JSON.parse(result.text) };
  } catch {
    return { ok: false, text: `${pathWithQuery} returned a body that is not JSON: ${result.text.slice(0, 400)}` };
  }
}

// ------------------------------------------------------------------ arguments --

// Thrown by a tool handler when the arguments cannot be used. The dispatcher
// turns it into a tool result with isError, not a JSON-RPC error, so the calling
// model sees the reason and can correct itself.
class Refusal extends Error {}

function requireString(args, name) {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Refusal(`"${name}" is required and must be a non-empty string.`);
  }
  return value;
}

function requireArray(args, name) {
  const value = args[name];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Refusal(`"${name}" is required and must be a non-empty array.`);
  }
  return value;
}

function optionalString(args, name) {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Refusal(`"${name}" must be a string if given.`);
  return value;
}

function briefPath(args, suffix = "") {
  const id = requireString(args, "briefId");
  // Encoded because it lands in a URL path, and the same string is signed as
  // part of the canonical request — the two must agree.
  return `/api/briefs/${encodeURIComponent(id.trim())}${suffix}`;
}

function pretty(data) {
  return JSON.stringify(data, null, 2);
}

// --------------------------------------------------------------------- format --

function formatBriefCreated(data) {
  const invitations = Array.isArray(data.invitations) ? data.invitations : [];
  const lines = [`Brief created: ${data.title}`, "", `BRIEF ID: ${data.id}`];
  lines.push("Every later call — read_responses, await_responses, close_brief, get_artifact — needs that id.");
  lines.push("");

  if (invitations.length > 0) {
    lines.push("PARTICIPANT LINKS — give each person their own. They are personal and not interchangeable:");
    lines.push("");
    for (const invitation of invitations) lines.push(`  ${invitation.name}: ${invitation.url}`);
    lines.push("");
    lines.push("Hand these links to a human now, then call await_responses to wait for the answers.");
  } else {
    // The API inlines the rendered HTML here, but it is several KB of document
    // and get_artifact exists to fetch it deliberately.
    lines.push("No participant links: this brief asks for nothing, so it is already closed.");
    lines.push("Call get_artifact with the id above to fetch the rendered HTML.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------- tools --

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false };

const CLOSE_WHEN_SCHEMA = {
  type: "object",
  description:
    'When collection stops. {"kind":"all"} (default) waits for every participant; ' +
    '{"kind":"quorum","n":2} stops after n people answer; {"kind":"deadline","at":"2026-01-31T17:00:00Z"} ' +
    'stops at an ISO 8601 instant; {"kind":"manual"} stops only when you call close_brief.',
  properties: {
    kind: { type: "string", enum: ["all", "quorum", "deadline", "manual"] },
    n: { type: "integer", minimum: 1, description: 'Required when kind is "quorum".' },
    at: { type: "string", description: 'Required when kind is "deadline". ISO 8601, e.g. 2026-01-31T17:00:00Z.' },
  },
  required: ["kind"],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: "list_widgets",
    description:
      "List every widget in the library: name, one-line summary, and the props each one takes. " +
      "Call this FIRST, before writing a brief — most of what you want already exists (asking one " +
      "question, picking between options, an approval, a comparison table, a findings list), and a " +
      "widget reference is far shorter and renders better than hand-built blocks. Only define a new " +
      "widget when nothing here fits.",
    inputSchema: NO_ARGUMENTS,
    async run() {
      const result = await apiJson("GET", "/api/widgets");
      if (!result.ok) return result;
      return { ok: true, text: pretty(result.data) };
    },
  },

  {
    name: "create_brief",
    description:
      "Create a brief — a small rendered page of context plus questions — and get back one personal " +
      "link per participant to hand to a human. Use it for decisions worth a page: several questions, " +
      "real context above them, or more than one person's view.\n\n" +
      "Blocks are the body of the page, in order. Each is either a widget reference " +
      '{"widget":"pick-one","props":{...}} (call list_widgets first) or a raw primitive block such as ' +
      '{"kind":"heading","level":2,"text":"..."}, {"kind":"prose","text":"..."}, ' +
      '{"kind":"callout","tone":"warn","text":"..."}, {"kind":"list"}, {"kind":"table"}, ' +
      '{"kind":"code"}, {"kind":"keyValue"}, {"kind":"divider"}, or {"kind":"field","spec":{...}} for a ' +
      "question. Participants are required as soon as any block collects input.\n\n" +
      "Answers are coalesced per question and disagreement is reported, never resolved: if two people " +
      "answer differently you get both answers and the conflict flagged, and deciding is your job. " +
      "After creating a brief, give the links to a human and then call await_responses.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Page title. Say what is being decided." },
        purpose: {
          type: "string",
          description:
            "What you will do with the answers. Required: answers that arrive with no record of what " +
            "they were for are useless to whoever picks them up after you are gone.",
        },
        resumeHint: {
          type: "string",
          description: "Optional. How work should resume once the answers are in — a command, a file, a next step.",
        },
        participants: {
          type: "array",
          description:
            "The people to ask. Each gets their own link. Required if any block collects input.",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Display name, shown on the page." },
              role: { type: "string", description: "Optional. Why this person is being asked." },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        blocks: {
          type: "array",
          minItems: 1,
          description:
            'Page body in order. Each item is either {"widget":"<name>","props":{...}} or a raw primitive block.',
          items: { type: "object" },
        },
        closeWhen: CLOSE_WHEN_SCHEMA,
        visibility: {
          type: "string",
          enum: ["blind", "open"],
          description:
            'Default "blind": participants cannot see each other\'s answers, which is a survey. ' +
            '"open" shows answers so far, which is a deliberation. They produce different answers.',
        },
      },
      required: ["title", "purpose", "blocks"],
      additionalProperties: false,
    },
    async run(args) {
      const body = {
        title: requireString(args, "title"),
        blocks: requireArray(args, "blocks"),
        intent: { purpose: requireString(args, "purpose") },
        policy: {
          closeWhen: args.closeWhen ?? { kind: "all" },
          visibility: args.visibility ?? "blind",
        },
      };

      const resumeHint = optionalString(args, "resumeHint");
      if (resumeHint !== undefined) body.intent.resumeHint = resumeHint;

      if (args.participants !== undefined) {
        if (!Array.isArray(args.participants)) throw new Refusal('"participants" must be an array if given.');
        body.participants = args.participants;
      }

      const closeWhen = body.policy.closeWhen;
      if (closeWhen.kind === "quorum" && typeof closeWhen.n !== "number") {
        throw new Refusal('closeWhen kind "quorum" needs a number "n".');
      }
      if (closeWhen.kind === "deadline" && typeof closeWhen.at !== "string") {
        throw new Refusal('closeWhen kind "deadline" needs an ISO 8601 timestamp "at".');
      }

      const result = await apiJson("POST", "/api/briefs", body);
      if (!result.ok) return result;
      return { ok: true, text: formatBriefCreated(result.data) };
    },
  },

  {
    name: "read_responses",
    description:
      "Read a brief right now: whether collection has closed, who has answered, who has not, the " +
      "answers coalesced per question, and any conflicts between participants. Returns immediately " +
      "with whatever has arrived. Use await_responses instead if you are willing to wait.",
    inputSchema: {
      type: "object",
      properties: { briefId: { type: "string", description: "The id returned by create_brief." } },
      required: ["briefId"],
      additionalProperties: false,
    },
    async run(args) {
      const result = await apiJson("GET", briefPath(args));
      if (!result.ok) return result;
      return { ok: true, text: pretty(result.data) };
    },
  },

  {
    name: "await_responses",
    description:
      "Wait for a brief to finish collecting, then return the same shape read_responses does. The " +
      "connection is held open until the brief closes under its closeWhen policy or the timeout " +
      "expires.\n\n" +
      'A timeout is a normal outcome, not an error: you get whatever has arrived so far with ' +
      '"timedOut": true, and you can wait again, call close_brief to take what you have, or hand the ' +
      "brief id to whoever continues the work.",
    inputSchema: {
      type: "object",
      properties: {
        briefId: { type: "string", description: "The id returned by create_brief." },
        timeoutSeconds: {
          type: "integer",
          minimum: 1,
          maximum: 600,
          description: "How long to hold the connection. Default 300, capped at 600. The service may cap it lower.",
        },
      },
      required: ["briefId"],
      additionalProperties: false,
    },
    async run(args) {
      const requested = args.timeoutSeconds === undefined ? 300 : Number(args.timeoutSeconds);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Refusal('"timeoutSeconds" must be a positive number if given.');
      }
      const seconds = Math.min(Math.floor(requested), 3600);
      const deadline = Date.now() + seconds * 1000;

      // ONE WAIT, MANY POLLS. Cloudflare gives an origin about 100 seconds to
      // respond before it answers 524 itself; a 150s poll through the tunnel was
      // measured dying at 125s with no body. So no single request may approach
      // that ceiling. Each poll returns inside it, and this loop keeps asking
      // until the brief closes or the caller's own budget runs out -- which is
      // why the caller can ask for an hour and still get an answer rather than a
      // gateway error.
      const PER_POLL_MS = 75_000;
      let latest;
      do {
        const remaining = deadline - Date.now();
        const slice = Math.max(Math.min(PER_POLL_MS, remaining), 1_000);
        const path = `${briefPath(args, "/await")}?timeout_ms=${slice}`;

        // The client deadline sits past the server's, so a poll that runs its
        // full budget is answered rather than aborted a moment before it replies.
        const result = await apiJson("GET", path, undefined, slice + 15_000);
        if (!result.ok) return result;
        latest = result.data;
        if (latest && latest.closed === true) return { ok: true, text: pretty(latest) };
      } while (Date.now() < deadline);

      return { ok: true, text: pretty(latest) };
    },
  },

  {
    name: "close_brief",
    description:
      "Stop collecting on a brief now and return what has arrived. Use it when you have enough, when " +
      "the closeWhen policy is 'manual', or when someone is not going to answer. Anyone opening a " +
      "participant link afterwards can no longer submit.",
    inputSchema: {
      type: "object",
      properties: { briefId: { type: "string", description: "The id returned by create_brief." } },
      required: ["briefId"],
      additionalProperties: false,
    },
    async run(args) {
      const result = await apiJson("POST", briefPath(args, "/close"), {});
      if (!result.ok) return result;
      return { ok: true, text: pretty(result.data) };
    },
  },

  {
    name: "get_artifact",
    description:
      "Fetch the brief rendered as one self-contained HTML document — context, questions, and any " +
      "answers received, with styles inlined and no external references. Suitable for publishing " +
      "straight as a Claude artifact or saving as a file. Returns HTML, not JSON, and can be several " +
      "KB, so fetch it when you actually intend to show it.",
    inputSchema: {
      type: "object",
      properties: { briefId: { type: "string", description: "The id returned by create_brief." } },
      required: ["briefId"],
      additionalProperties: false,
    },
    async run(args) {
      const result = await api("GET", briefPath(args, "/artifact"));
      if (!result.ok) return result;
      return { ok: true, text: result.text };
    },
  },

];

// ------------------------------------------------------------------- protocol --

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function sendToolText(id, text, isError) {
  sendResult(id, { content: [{ type: "text", text }], isError });
}

async function handleToolCall(id, params) {
  const name = params?.name;
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    sendError(id, -32601, `unknown tool: ${String(name)}. Call tools/list for the available tools.`);
    return;
  }

  const args = params?.arguments ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    sendToolText(id, "Refused: arguments must be a JSON object.", true);
    return;
  }

  try {
    const result = await tool.run(args);
    sendToolText(id, result.ok ? result.text : `Refused: ${result.text}`, !result.ok);
  } catch (error) {
    if (error instanceof Refusal) {
      sendToolText(id, `Refused: ${error.message}`, true);
      return;
    }
    // Still a tool result rather than a protocol error: the call failed, the
    // connection did not, and the model can act on the reason.
    log(`tool ${tool.name} threw:`, error instanceof Error ? error.stack ?? error.message : String(error));
    const detail = error instanceof Error ? error.message : String(error);
    sendToolText(id, `Refused: ${tool.name} failed unexpectedly — ${detail}`, true);
  }
}

async function handleRequest(id, method, params) {
  switch (method) {
    case "initialize": {
      // Echo the client's protocol version when it sends one. This server has no
      // version-specific behaviour — it implements tools/list and tools/call,
      // which are stable across every revision of the spec — so echoing accepts
      // whatever the client already speaks instead of guessing at a version
      // string that keeps moving.
      const requested = params?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && requested !== "" ? requested : FALLBACK_PROTOCOL_VERSION;
      sendResult(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      return;
    }
    case "ping":
      sendResult(id, {});
      return;
    case "tools/list":
      sendResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
      return;
    case "tools/call":
      await handleToolCall(id, params);
      return;
    default:
      sendError(id, -32601, `unknown method: ${method}`);
  }
}

// A line that is not JSON still deserves a reply when the id is legible, because
// a client waiting on that id would otherwise hang until it gives up.
function recoverId(line) {
  const match = /"id"\s*:\s*(\d+|"[^"]*")/.exec(line);
  if (match === null) return undefined;
  return match[1].startsWith('"') ? match[1].slice(1, -1) : Number(match[1]);
}

async function handleLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    const id = recoverId(trimmed);
    if (id === undefined) log("dropped a line that is not valid JSON");
    else sendError(id, -32700, "parse error: line is not valid JSON");
    return;
  }

  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    log("dropped a message that is not a JSON-RPC object");
    return;
  }

  const { id, method, params } = message;

  // No id means a notification: notifications/initialized, cancellations, and
  // anything else the client tells us about. Acting on them is allowed, replying
  // to them is not.
  if (id === undefined || id === null) {
    log(`notification: ${typeof method === "string" ? method : "(no method)"}`);
    return;
  }
  if (typeof method !== "string") {
    // A message with an id and no method is a response to a request. This server
    // makes none, so there is nothing to correlate it with.
    log("ignored a message with an id but no method");
    return;
  }

  try {
    await handleRequest(id, method, params);
  } catch (error) {
    log(`handling ${method} failed:`, error instanceof Error ? error.stack ?? error.message : String(error));
    sendError(id, -32603, `internal error handling ${method}`);
  }
}

// The transport is newline-delimited JSON, one message per line. No
// Content-Length framing.
const lines = createInterface({ input: process.stdin });

// Not awaited: a long await_responses can hold its connection for minutes, and
// serialising would leave pings and other calls queued behind it for that whole
// time. Each line carries its own id, so replies may return out of order.
//
// Which means work outlives the line that started it, and stdin closing is not
// the same event as being finished. Exiting on close alone kills whatever is in
// flight and can truncate a reply mid-write, so the count is tracked and the
// exit waits for it.
let inFlight = 0;
let stdinClosed = false;

function exitWhenDrained() {
  if (stdinClosed && inFlight === 0) process.exit(0);
}

lines.on("line", (line) => {
  inFlight += 1;
  handleLine(line)
    .catch((error) => {
      log("line handler rejected:", error instanceof Error ? error.stack ?? error.message : String(error));
    })
    .finally(() => {
      inFlight -= 1;
      exitWhenDrained();
    });
});

lines.on("close", () => {
  stdinClosed = true;
  if (inFlight === 0) {
    process.exit(0);
    return;
  }
  log(`stdin closed with ${inFlight} request(s) in flight; draining`);
  // A bound, so a wedged request cannot keep the process alive for ever. Longer
  // than one poll slice, so an await_responses in its wait is not cut short.
  setTimeout(() => {
    log("drain timed out; exiting anyway");
    process.exit(0);
  }, 90_000).unref();
});

// A dead server looks to the client like a broken connection with no
// explanation, so nothing that arrives over the wire is allowed to end the
// process. Same reason missing credentials are reported per tool call rather
// than refused at startup.
process.on("uncaughtException", (error) => {
  log("uncaught exception:", error instanceof Error ? error.stack ?? error.message : String(error));
});
process.on("unhandledRejection", (reason) => {
  log("unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : String(reason));
});

log(`ready — ${BASE_URL}, credentials in ${CRED_DIR}`);
