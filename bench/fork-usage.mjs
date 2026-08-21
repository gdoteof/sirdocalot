// Reads what a forked agent was billed, out of its own transcript.
//
// Two forks of one session were asked to hand the same work to a person, one
// through sirdocalot and one as a published artifact. Because a fork inherits its
// parent's context exactly, the difference between the two transcripts is the
// cost of the medium and nothing else.
//
// The transcripts are far too large to read directly, and they do not need to be
// read: every assistant message carries its own usage, so the totals are a sum.
//
// Usage:  node bench/fork-usage.mjs <label>=<transcript.jsonl> ...

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "results", "forks");

// Output tokens are billed per assistant message and accumulate. Input is not a
// sum: each turn re-reads the whole conversation, so adding the turns up counts
// the same context many times over. The honest figures are the total written,
// and the largest context any single turn was charged for.
function summarise(path) {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const turns = [];
  const tools = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const message = entry.message ?? entry;
    const usage = message?.usage;
    if (usage !== undefined && message?.role === "assistant") {
      turns.push({
        output: usage.output_tokens ?? 0,
        thinking: usage.output_tokens_details?.thinking_tokens ?? 0,
        input: usage.input_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheCreate: usage.cache_creation_input_tokens ?? 0,
      });
    }
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type === "tool_use") tools.push(block.name);
    }
  }

  const sum = (pick) => turns.reduce((t, x) => t + pick(x), 0);
  const context = turns.map((t) => t.input + t.cacheRead + t.cacheCreate);

  return {
    assistantTurns: turns.length,
    outputTokens: sum((t) => t.output),
    thinkingTokens: sum((t) => t.thinking),
    documentTokens: sum((t) => t.output) - sum((t) => t.thinking),
    // What the fork added to the context it inherited.
    contextAtStart: context.length > 0 ? Math.min(...context) : 0,
    contextAtEnd: context.length > 0 ? context[context.length - 1] : 0,
    peakContext: context.length > 0 ? Math.max(...context) : 0,
    cacheCreationTokens: sum((t) => t.cacheCreate),
    uncachedInputTokens: sum((t) => t.input),
    toolCalls: tools,
  };
}

const report = {};
for (const arg of process.argv.slice(2)) {
  const [label, path] = arg.split("=");
  report[label] = { transcript: realpathSync(path), ...summarise(path) };
}

for (const [label, r] of Object.entries(report)) {
  report[label].contextGrowth = r.contextAtEnd - r.contextAtStart;
  console.log(
    `${label.padEnd(10)} out ${String(r.outputTokens).padStart(6)} ` +
      `(doc ${String(r.documentTokens).padStart(6)}, think ${String(r.thinkingTokens).padStart(5)})  ` +
      `turns ${String(r.assistantTurns).padStart(2)}  ` +
      `context ${r.contextAtStart.toLocaleString()} → ${r.contextAtEnd.toLocaleString()} ` +
      `(+${report[label].contextGrowth.toLocaleString()})`,
  );
  console.log(`${" ".repeat(10)} tools: ${r.toolCalls.join(", ") || "none"}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "fork-usage.json"), `${JSON.stringify(report, null, 2)}\n`);
