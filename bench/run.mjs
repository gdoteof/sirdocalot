// Measures what a brief costs against what an authored page costs.
//
// The landing page claims a brief is far cheaper to generate than the HTML page
// that says the same thing. This runs both arms over the same source material
// and records exactly what each one was billed, so the claim has receipts.
//
// Fairness is the whole design here, and it comes down to three rules:
//
//   1. Both arms get the same system prompt, the same ask, and the same source.
//      The only difference is the last paragraph, naming the output format.
//   2. Neither arm is told to be elaborate or to be brief. A prompt that asks
//      arm A for something showy inflates the ratio into marketing.
//   3. Arm B's extra input -- the widget vocabulary and the create_brief schema
//      -- is real and is measured. It is pulled from the running MCP server, so
//      it is the surface an agent actually sees rather than a lean paraphrase.
//
// Usage:  node bench/run.mjs [--model opus] [--repeats 3] [--concurrency 3]
//                            [--scenario id] [--refresh-vocabulary]

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// A brief the API would refuse is not a cheaper document, it is a failed one.
// Validating every run here means the report can say how often an agent gets a
// usable brief on the first attempt, which matters more than what it cost.
import { resolveBlocks } from "../src/application/resolve-blocks.ts";
import { builtinWidgets } from "../src/adapters/registry/widgets.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RUNS = join(HERE, "results", "runs");

// Identical for both arms. Deliberately says nothing about length or polish:
// the arms differ in what they emit, and nothing else.
const SYSTEM = [
  "You produce documents that people read.",
  "Emit only the artefact that was asked for -- no preamble, no commentary, and no explanation of what you did.",
].join(" ");

function args() {
  const a = process.argv.slice(2);
  const get = (flag, fallback) => {
    const i = a.indexOf(flag);
    return i === -1 ? fallback : a[i + 1];
  };
  return {
    model: get("--model", "opus"),
    repeats: Number(get("--repeats", "3")),
    concurrency: Number(get("--concurrency", "3")),
    scenario: get("--scenario", null),
    refreshVocabulary: a.includes("--refresh-vocabulary"),
  };
}

// Scenario files are markdown with YAML-ish frontmatter. Only a handful of keys
// are read, so this stays a few lines rather than a dependency.
function loadScenarios(only) {
  const dir = join(HERE, "scenarios");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const text = readFileSync(join(dir, f), "utf8");
      const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
      if (!m) throw new Error(`${f}: no frontmatter`);
      const meta = {};
      let key = null;
      for (const line of m[1].split("\n")) {
        const kv = /^(\w+):\s*(.*)$/.exec(line);
        if (kv) {
          key = kv[1];
          meta[key] = kv[2] === ">-" ? "" : kv[2];
        } else if (key && line.startsWith("  ")) {
          meta[key] = `${meta[key]} ${line.trim()}`.trim();
        }
      }
      return {
        id: meta.id,
        title: meta.title,
        source: meta.source,
        collects: meta.collects === "true",
        participants: meta.participants ? JSON.parse(meta.participants) : [],
        ask: meta.ask,
        body: m[2].trim(),
      };
    })
    .filter((s) => only === null || s.id === only);
}

// The tool definitions an agent is actually handed, asked of the real MCP server
// over stdio. Taken from the server rather than restated here, because a
// restatement is a chance to quietly make arm B's input smaller than it is.
async function agentSurface() {
  const proc = spawn("node", [join(ROOT, "client", "mcp-server.mjs")], {
    stdio: ["pipe", "pipe", "ignore"],
    env: { ...process.env, SIRDOCALOT_URL: process.env.SIRDOCALOT_URL ?? "https://sirdocalot.vteng.io" },
  });
  const send = (msg) => proc.stdin.write(`${JSON.stringify(msg)}\n`);
  const replies = new Map();
  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let nl; (nl = buffer.indexOf("\n")) !== -1; ) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) replies.get(msg.id)?.(msg);
      } catch {
        /* the server logs to stderr, but a stray line here is not fatal */
      }
    }
  });
  const call = (id, method, params = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 15_000);
      replies.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg.result);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });

  try {
    await call(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sirdocalot-bench", version: "1" },
    });
    const { tools } = await call(2, "tools/list");
    return tools.filter((t) => t.name === "create_brief");
  } finally {
    proc.kill();
  }
}

function vocabulary(refresh) {
  const path = join(HERE, "vocabulary.json");
  if (refresh) {
    const base = process.env.SIRDOCALOT_URL ?? "https://sirdocalot.vteng.io";
    const key = process.env.AGENT_KEY;
    if (!key) throw new Error("--refresh-vocabulary needs AGENT_KEY");
    const out = spawnSync("curl", ["-fsS", "-H", `Authorization: Bearer ${key}`, `${base}/api/widgets`]);
    writeFileSync(path, out.stdout);
  }
  return readFileSync(path, "utf8");
}

// The shared half of the prompt. Both arms see this and nothing about it hints
// at a format.
function commonPrompt(scenario) {
  const who = scenario.collects
    ? `\n\nThe people who must answer are: ${scenario.participants.join(", ")}.`
    : "";
  return `${scenario.ask}${who}\n\n--- source material ---\n${scenario.body}\n--- end source material ---`;
}

function promptFor(arm, scenario, surface, vocab) {
  const common = commonPrompt(scenario);
  if (arm === "artifact") {
    return `${common}\n\nEmit a complete, self-contained HTML document. It must open in a browser on its own, with no external files.${
      scenario.collects ? " It must include a form those people can fill in." : ""
    }`;
  }
  return [
    common,
    "",
    "Emit the JSON arguments for the create_brief tool below. Compose the page from the widget vocabulary; do not write HTML.",
    "",
    "--- create_brief ---",
    JSON.stringify(surface, null, 2),
    "--- end create_brief ---",
    "",
    "--- widget vocabulary ---",
    vocab,
    "--- end widget vocabulary ---",
  ].join("\n");
}

// One generation. Tools are off and the default system prompt is replaced, so
// what is billed is the document and nothing else -- no file reads, no harness
// preamble, and the same fixed overhead in both arms.
function generate(model, prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      [
        "-p", "--output-format", "json",
        "--model", model,
        "--system-prompt", SYSTEM,
        "--tools", "",
        "--disable-slash-commands",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--no-session-persistence",
      ],
      { cwd: HERE, stdio: ["pipe", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`unparseable CLI output: ${String(e)}`));
      }
    });
    proc.stdin.end(prompt);
  });
}

// The auxiliary call is not counted in the top-level `usage`, which is what the
// numbers above come from -- this only decides what to call the run.
function modelThatWrote(result) {
  const usage = result.modelUsage ?? {};
  const entries = Object.entries(usage);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0))[0][0];
}

// Models wrap output in a fence often enough that the raw text is not always the
// artefact. Tokens are always counted on the raw text, which is what was billed;
// this only affects what gets rendered and validated.
function unfence(text) {
  const m = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1] : text.trim();
}

const WIDGETS = builtinWidgets();

// The same path a real POST /api/briefs takes, so "would have been refused" here
// means it would have been refused there.
async function validate(output) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (e) {
    return { accepted: false, errors: [`not JSON: ${String(e)}`] };
  }
  const resolved = await resolveBlocks(WIDGETS, parsed.blocks ?? []);
  return resolved.ok ? { accepted: true, errors: [] } : { accepted: false, errors: resolved.errors };
}

async function pool(items, size, worker) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }),
  );
  return results;
}

async function main() {
  const opts = args();
  const scenarios = loadScenarios(opts.scenario);
  const surface = await agentSurface();
  const vocab = vocabulary(opts.refreshVocabulary);
  mkdirSync(RUNS, { recursive: true });

  const cells = [];
  for (const scenario of scenarios) {
    for (const arm of ["artifact", "brief"]) {
      for (let n = 1; n <= opts.repeats; n++) cells.push({ scenario, arm, n });
    }
  }
  console.error(`${cells.length} runs: ${scenarios.length} scenarios x 2 arms x ${opts.repeats} repeats on ${opts.model}`);

  await pool(cells, opts.concurrency, async ({ scenario, arm, n }) => {
    const prompt = promptFor(arm, scenario, surface, vocab);
    const started = Date.now();
    const result = await generate(opts.model, prompt);
    const u = result.usage ?? {};
    const record = {
      scenario: scenario.id,
      arm,
      repeat: n,
      // The CLI bills a small auxiliary model alongside the one doing the work,
      // and its entry can come first. The document's author is whichever model
      // produced the output, so the label follows the tokens.
      model: modelThatWrote(result) ?? opts.model,
      promptChars: prompt.length,
      usage: {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        uncachedInputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
      },
      costUsd: result.total_cost_usd ?? null,
      durationMs: result.duration_ms ?? Date.now() - started,
      output: unfence(result.result ?? ""),
    };
    record.usage.documentTokens = record.usage.outputTokens - record.usage.thinkingTokens;
    if (arm === "brief") record.validity = await validate(record.output);
    writeFileSync(join(RUNS, `${scenario.id}-${arm}-${n}.json`), `${JSON.stringify(record, null, 2)}\n`);
    const verdict = record.validity === undefined ? "" : record.validity.accepted ? " valid" : " REFUSED";
    console.error(
      `  ${scenario.id} ${arm} #${n}: ${record.usage.outputTokens} out ` +
        `(${record.usage.documentTokens} doc), ${Math.round(record.durationMs / 1000)}s${verdict}`,
    );
    return record;
  });

  console.error("done — next: node bench/summarize.mjs");
}

await main();
