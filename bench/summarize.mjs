// Turns the individual runs into the report the /bench page serves.
//
// Everything here is arithmetic over what the runs already recorded. It computes
// no ratio the runs do not support, and it carries the losing numbers as well as
// the winning ones -- a summary that only keeps the flattering column is how a
// benchmark becomes an advertisement.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The service's own renderer, so the "what the operator sees" column on the
// /bench page is produced by the code that serves real briefs rather than by a
// second implementation written to look convincing.
import { resolveBlocks } from "../src/application/resolve-blocks.ts";
import { builtinWidgets } from "../src/adapters/registry/widgets.ts";
import { renderBlocks } from "../src/adapters/render/blocks.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, "results", "runs");

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Charged at Opus list price. Stated rather than taken from the CLI's own figure
// so the arithmetic on the page can be checked by hand.
const PRICE = { inputPerM: 5, outputPerM: 25 };

function scenarioMeta(id) {
  const text = readFileSync(join(HERE, "scenarios", `${id}.md`), "utf8");
  const front = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const get = (k) => (new RegExp(`^${k}:\\s*(.*)$`, "m").exec(front[1]) ?? [])[1] ?? "";
  return {
    id,
    title: get("title"),
    source: get("source"),
    collects: get("collects") === "true",
    sourceWords: front[2].trim().split(/\s+/).length,
  };
}

const runs = readdirSync(RUNS)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(RUNS, f), "utf8")));

const scenarios = [...new Set(runs.map((r) => r.scenario))].sort();

const report = {
  model: runs[0]?.model ?? null,
  repeats: Math.max(...runs.map((r) => r.repeat)),
  price: PRICE,
  scenarios: scenarios.map((id) => {
    const arms = {};
    for (const arm of ["artifact", "brief"]) {
      const rs = runs.filter((r) => r.scenario === id && r.arm === arm).sort((a, b) => a.repeat - b.repeat);
      const doc = rs.map((r) => r.usage.documentTokens);
      const out = rs.map((r) => r.usage.outputTokens);
      // The run whose document is the median length, kept whole so the page can
      // show what was actually produced rather than describe it.
      const representative = rs.find((r) => r.usage.documentTokens === median(doc)) ?? rs[0];
      arms[arm] = {
        runs: rs.length,
        documentTokens: { median: median(doc), min: Math.min(...doc), max: Math.max(...doc) },
        outputTokens: { median: median(out), min: Math.min(...out), max: Math.max(...out) },
        thinkingTokens: { median: median(rs.map((r) => r.usage.thinkingTokens)) },
        inputTokens: { median: median(rs.map((r) => r.usage.inputTokens)) },
        durationMs: { median: median(rs.map((r) => r.durationMs)) },
        output: representative.output,
        outputChars: representative.output.length,
      };
    }
    const ratio = (pick) => Number((pick(arms.artifact) / pick(arms.brief)).toFixed(2));
    return {
      ...scenarioMeta(id),
      arms,
      ratios: {
        documentTokens: ratio((a) => a.documentTokens.median),
        outputTokens: ratio((a) => a.outputTokens.median),
        duration: ratio((a) => a.durationMs.median),
      },
      // What arm B pays that arm A does not: the vocabulary and the tool schema
      // in front of the same source material.
      extraInputTokens: arms.brief.inputTokens.median - arms.artifact.inputTokens.median,
    };
  }),
};

// Arm B emitted tool arguments, not a page. Putting the two side by side means
// turning those arguments into the page they stand for, through the same
// resolve-and-render path a real brief takes.
const widgets = builtinWidgets();
for (const scenario of report.scenarios) {
  const brief = scenario.arms.brief;
  try {
    const args = JSON.parse(brief.output);
    const resolved = await resolveBlocks(widgets, args.blocks ?? []);
    brief.rendered = resolved.ok
      ? renderBlocks(resolved.value)
      : null;
    brief.renderErrors = resolved.ok ? [] : resolved.errors;
    brief.briefTitle = args.title ?? null;
  } catch (e) {
    // A brief that will not parse is a result, not a crash. The page reports it.
    brief.rendered = null;
    brief.renderErrors = [String(e)];
  }
}

const docRatios = report.scenarios.map((s) => s.ratios.documentTokens);
report.overall = {
  documentTokenRatio: { median: median(docRatios), min: Math.min(...docRatios), max: Math.max(...docRatios) },
  durationRatio: median(report.scenarios.map((s) => s.ratios.duration)),
  extraInputTokens: median(report.scenarios.map((s) => s.extraInputTokens)),
  totalRuns: runs.length,
};

// Output costs five times input, so the vocabulary surcharge is repaid by the
// output it saves. Stated as a count of briefs because that is the unit an
// operator has an intuition for.
const savedOutput = median(report.scenarios.map((s) => s.arms.artifact.documentTokens.median - s.arms.brief.documentTokens.median));
report.overall.savedOutputTokensPerDocument = savedOutput;
report.overall.breakEvenDocuments = Number(
  ((report.overall.extraInputTokens * PRICE.inputPerM) / (savedOutput * PRICE.outputPerM)).toFixed(2),
);

writeFileSync(join(HERE, "results", "summary.json"), `${JSON.stringify(report, null, 2)}\n`);

for (const s of report.scenarios) {
  console.log(
    `${s.id.padEnd(16)} artifact ${String(s.arms.artifact.documentTokens.median).padStart(5)}  ` +
      `brief ${String(s.arms.brief.documentTokens.median).padStart(5)}  ratio ${s.ratios.documentTokens}x`,
  );
}
console.log(`\noverall ${report.overall.documentTokenRatio.median}x (range ${report.overall.documentTokenRatio.min}–${report.overall.documentTokenRatio.max}x)`);
console.log(`arm B extra input: ${report.overall.extraInputTokens} tokens, break-even after ${report.overall.breakEvenDocuments} documents`);
