// The same session, forked twice, asked to hand the same work to a person.
//
// An earlier version of this benchmark generated a document from a cold prompt
// and compared token counts. That measured the wrong thing. What an operator
// actually pays is the cost of a turn inside a session that already holds the
// work -- the file reads, the analysis, the tool schemas -- and the two paths
// diverge only at the moment they are asked to hand it over.
//
// So: one base session does real work. It is then forked, and each fork gets the
// same instruction differing only in the medium. Because a fork inherits the
// parent's context byte for byte, the difference between the two runs is the
// cost of the medium and nothing else.
//
// Usage:  node bench/fork-run.mjs [--repeats 3] [--model opus] [--base <uuid>]

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(HERE, "results", "forks");
const MCP = join(OUT, "mcp.json");

// What the base session does. Real work over real files, producing something a
// person would genuinely need handing to them.
const BASE_WORK = `Read docs/SELF-HOSTING.md and docs/DESIGN.md in this repository.

Work out two things: the operational constraints somebody self-hosting this must
know before it is load-bearing for their team, and the design questions still
marked open. Tell me what you found.

Do not write, create or publish anything yet.`;

// The fork instructions. Identical up to the medium, which is the last sentence.
// Neither asks for something elaborate and neither asks for restraint: a prompt
// that pushes either way decides the result instead of measuring it.
const HANDOVER = `Now hand that to the operator, so they can read it at their own pace rather than out of this transcript.`;

const ARMS = {
  brief: `${HANDOVER}\n\nUse sirdocalot: create a brief for them.`,
  artifact: `${HANDOVER}\n\nProduce it as a shareable self-contained HTML artifact, written to bench/results/forks/artifact-RUN.html.`,
};

function args() {
  const a = process.argv.slice(2);
  const get = (f, d) => (a.indexOf(f) === -1 ? d : a[a.indexOf(f) + 1]);
  return { repeats: Number(get("--repeats", "3")), model: get("--model", "opus"), base: get("--base", null) };
}

// The CLI answers either a single result object or a stream of messages
// depending on what is configured, so the reader accepts both.
function resultOf(raw) {
  const parsed = JSON.parse(raw);
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const results = messages.filter((m) => m.type === "result" || m.usage !== undefined);
  if (results.length === 0) throw new Error("no result message in CLI output");
  return results[results.length - 1];
}

function claude(extra, prompt, model) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model, "--mcp-config", MCP, "--strict-mcp-config",
       "--permission-mode", "bypassPermissions", ...extra],
      { cwd: ROOT, stdio: ["pipe", "pipe", "ignore"] },
    );
    let out = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}`));
      try {
        resolve(resultOf(out));
      } catch (e) {
        reject(e);
      }
    });
    proc.stdin.end(prompt);
  });
}

// A turn's usage, plus the size of the context it ran against. Context is what
// the model was handed before it answered: everything cached plus everything new.
function measure(result) {
  const u = result.usage ?? {};
  const iterations = u.iterations ?? [];
  const last = iterations[iterations.length - 1] ?? u;
  return {
    inputTokens: u.input_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
    // Every token the model was charged for reading, however it was charged.
    totalInputTokens:
      (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    contextAtEnd:
      (last.input_tokens ?? 0) + (last.cache_read_input_tokens ?? 0) + (last.cache_creation_input_tokens ?? 0),
    turns: result.num_turns ?? iterations.length,
    costUsd: result.total_cost_usd ?? null,
    durationMs: result.duration_ms ?? null,
  };
}

async function main() {
  const opts = args();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    MCP,
    JSON.stringify({
      mcpServers: {
        sirdocalot: {
          type: "stdio",
          command: "node",
          args: [join(process.env.HOME, ".sirdocalot", "mcp-server.mjs")],
          env: { SIRDOCALOT_URL: process.env.SIRDOCALOT_URL ?? "https://sirdocalot.vteng.io" },
        },
      },
    }),
  );

  // One base session, reused by every fork. Forking never mutates it, so all
  // runs start from the same bytes -- which is the entire point of the design.
  let base = opts.base;
  if (base === null) {
    base = randomUUID();
    console.error(`base session ${base}: doing the work both forks will hand over`);
    const result = await claude(["--session-id", base], BASE_WORK, opts.model);
    const m = measure(result);
    writeFileSync(join(OUT, "base.json"), `${JSON.stringify({ sessionId: base, work: BASE_WORK, measured: m, result: result.result }, null, 2)}\n`);
    console.error(`  base context: ${m.contextAtEnd.toLocaleString()} tokens over ${m.turns} turns`);
  } else {
    console.error(`reusing base session ${base}`);
  }

  const runs = [];
  for (let n = 1; n <= opts.repeats; n++) {
    for (const [arm, instruction] of Object.entries(ARMS)) {
      const prompt = instruction.replace("RUN", String(n));
      const result = await claude(["--resume", base, "--fork-session"], prompt, opts.model);
      const m = measure(result);
      const record = { arm, repeat: n, base, forked: result.session_id, prompt, measured: m, said: result.result };
      writeFileSync(join(OUT, `${arm}-${n}.json`), `${JSON.stringify(record, null, 2)}\n`);
      runs.push(record);
      console.error(
        `  ${arm} #${n}: ${m.outputTokens} out, ${m.totalInputTokens.toLocaleString()} in, ` +
          `${m.turns} turns, ${Math.round((m.durationMs ?? 0) / 1000)}s`,
      );
    }
  }

  writeFileSync(join(OUT, "runs.json"), `${JSON.stringify({ base, model: opts.model, runs }, null, 2)}\n`);
  console.error(`done — ${runs.length} forks from one base session`);
}

await main();
