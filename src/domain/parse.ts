// The one place JSON becomes a primitive block.
//
// Blocks reach the service two ways -- expanded from a widget, or supplied
// directly by an agent -- and both go through here. One mapping site per
// boundary: a second parser would drift from this one, and the bug would appear
// in whichever path nobody changed.

import type { Json } from "./json.ts";
import { isJsonObject } from "./json.ts";
import type { ChoiceOption, FieldSpec } from "./fields.ts";
import type { PrimitiveBlock, Tone } from "./primitives.ts";
import type { ParsedAll } from "./result.ts";
import { noAll, okAll } from "./result.ts";
import { fieldId } from "./ids.ts";

type Ctx = { errors: string[] };

const TONES: readonly string[] = ["info", "warn", "success", "danger"];

function str(o: Record<string, Json>, key: string, at: string, ctx: Ctx, fallback?: string): string {
  const v = o[key];
  if (typeof v === "string") return v;
  if (v === undefined && fallback !== undefined) return fallback;
  ctx.errors.push(`${at}.${key}: expected a string`);
  return "";
}

function optStr(o: Record<string, Json>, key: string, at: string, ctx: Ctx): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  ctx.errors.push(`${at}.${key}: expected a string`);
  return undefined;
}

function optNum(o: Record<string, Json>, key: string, at: string, ctx: Ctx): number | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  ctx.errors.push(`${at}.${key}: expected a number`);
  return undefined;
}

function bool(o: Record<string, Json>, key: string, fallback: boolean, at: string, ctx: Ctx): boolean {
  const v = o[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "boolean") return v;
  ctx.errors.push(`${at}.${key}: expected true or false`);
  return fallback;
}

function strArray(o: Record<string, Json>, key: string, at: string, ctx: Ctx): string[] {
  const v = o[key];
  if (!Array.isArray(v)) {
    ctx.errors.push(`${at}.${key}: expected an array of strings`);
    return [];
  }
  return v.map((item, i) => {
    if (typeof item === "string") return item;
    // Numbers in a table cell or list item are common and unambiguous, so they
    // are coerced rather than refused. Anything else is a shape mistake.
    if (typeof item === "number" || typeof item === "boolean") return String(item);
    ctx.errors.push(`${at}.${key}[${i}]: expected a string`);
    return "";
  });
}

function parseFieldSpec(v: Json, at: string, ctx: Ctx): FieldSpec | undefined {
  if (!isJsonObject(v)) {
    ctx.errors.push(`${at}: expected a field spec object`);
    return undefined;
  }
  const idRaw = str(v, "id", at, ctx);
  const parsedId = fieldId(idRaw);
  if (!parsedId.ok) {
    ctx.errors.push(`${at}.id: ${parsedId.reason}`);
    return undefined;
  }
  const id = parsedId.value;
  const label = str(v, "label", at, ctx);
  const required = bool(v, "required", false, at, ctx);
  const help = optStr(v, "help", at, ctx);
  const base = { id, label, required, ...(help !== undefined ? { help } : {}) };
  const kind = str(v, "kind", at, ctx);

  switch (kind) {
    case "text": {
      const maxLength = optNum(v, "maxLength", at, ctx);
      return {
        kind: "text",
        ...base,
        long: bool(v, "long", false, at, ctx),
        ...(maxLength !== undefined ? { maxLength } : {}),
      };
    }
    case "number": {
      const min = optNum(v, "min", at, ctx);
      const max = optNum(v, "max", at, ctx);
      return {
        kind: "number",
        ...base,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      };
    }
    case "boolean":
      return { kind: "boolean", ...base };
    case "choice": {
      const raw = v["options"];
      const options: ChoiceOption[] = [];
      if (!Array.isArray(raw) || raw.length === 0) {
        ctx.errors.push(`${at}.options: a choice needs at least one option`);
      } else {
        raw.forEach((opt, i) => {
          if (typeof opt === "string") {
            options.push({ value: opt, label: opt });
          } else if (isJsonObject(opt)) {
            const value = str(opt, "value", `${at}.options[${i}]`, ctx);
            options.push({ value, label: optStr(opt, "label", `${at}.options[${i}]`, ctx) ?? value });
          } else {
            ctx.errors.push(`${at}.options[${i}]: expected a string or {value,label}`);
          }
        });
      }
      return { kind: "choice", ...base, options, multiple: bool(v, "multiple", false, at, ctx) };
    }
    case "rating": {
      const scale = optNum(v, "scale", at, ctx) ?? 5;
      if (!Number.isInteger(scale) || scale < 2 || scale > 10) {
        ctx.errors.push(`${at}.scale: expected a whole number between 2 and 10`);
      }
      return { kind: "rating", ...base, scale };
    }
    default:
      ctx.errors.push(`${at}.kind: unknown field kind "${kind}"`);
      return undefined;
  }
}

function parseBlock(v: Json, at: string, ctx: Ctx): PrimitiveBlock | undefined {
  if (!isJsonObject(v)) {
    ctx.errors.push(`${at}: expected a block object`);
    return undefined;
  }
  const kind = str(v, "kind", at, ctx);
  switch (kind) {
    case "heading": {
      const level = optNum(v, "level", at, ctx) ?? 2;
      const clamped = level === 1 || level === 2 || level === 3 ? level : 2;
      return { kind: "heading", level: clamped, text: str(v, "text", at, ctx) };
    }
    case "prose":
      return { kind: "prose", text: str(v, "text", at, ctx) };
    case "callout": {
      const toneRaw = str(v, "tone", at, ctx, "info");
      // Refused rather than defaulted. Silently recolouring an unknown tone to
      // "info" renders a finding an agent called critical as a calm blue box --
      // wrong in the direction that matters, and invisible to whoever wrote it.
      if (!TONES.includes(toneRaw)) {
        ctx.errors.push(`${at}.tone: expected one of ${TONES.join(", ")}, got "${toneRaw}"`);
      }
      const tone = toneRaw as Tone;
      const title = optStr(v, "title", at, ctx);
      return { kind: "callout", tone, text: str(v, "text", at, ctx), ...(title !== undefined ? { title } : {}) };
    }
    case "list":
      return { kind: "list", ordered: bool(v, "ordered", false, at, ctx), items: strArray(v, "items", at, ctx) };
    case "keyValue": {
      const raw = v["entries"];
      const entries: { key: string; value: string }[] = [];
      if (!Array.isArray(raw)) {
        ctx.errors.push(`${at}.entries: expected an array`);
      } else {
        raw.forEach((e, i) => {
          if (!isJsonObject(e)) {
            ctx.errors.push(`${at}.entries[${i}]: expected {key,value}`);
            return;
          }
          entries.push({
            key: str(e, "key", `${at}.entries[${i}]`, ctx),
            value: str(e, "value", `${at}.entries[${i}]`, ctx),
          });
        });
      }
      return { kind: "keyValue", entries };
    }
    case "table": {
      const columns = strArray(v, "columns", at, ctx);
      const rawRows = v["rows"];
      const rows: string[][] = [];
      if (!Array.isArray(rawRows)) {
        ctx.errors.push(`${at}.rows: expected an array of rows`);
      } else {
        rawRows.forEach((row, i) => {
          if (!Array.isArray(row)) {
            ctx.errors.push(`${at}.rows[${i}]: expected an array of cells`);
            return;
          }
          const cells = row.map((c) => (typeof c === "string" ? c : c === null ? "" : String(c)));
          // A ragged table renders as a broken one, and the break shows up in the
          // browser rather than here. Cheaper to refuse it at the boundary.
          if (cells.length !== columns.length) {
            ctx.errors.push(`${at}.rows[${i}]: ${cells.length} cells for ${columns.length} columns`);
          }
          rows.push(cells);
        });
      }
      const caption = optStr(v, "caption", at, ctx);
      return { kind: "table", columns, rows, ...(caption !== undefined ? { caption } : {}) };
    }
    case "code": {
      const language = optStr(v, "language", at, ctx);
      return { kind: "code", text: str(v, "text", at, ctx), ...(language !== undefined ? { language } : {}) };
    }
    case "divider":
      return { kind: "divider" };
    case "field": {
      const spec = parseFieldSpec(v["spec"] ?? null, `${at}.spec`, ctx);
      return spec === undefined ? undefined : { kind: "field", spec };
    }
    case "raw":
      return { kind: "raw", html: str(v, "html", at, ctx) };
    default:
      ctx.errors.push(`${at}.kind: unknown block kind "${kind}"`);
      return undefined;
  }
}

export function parseBlocks(v: Json, at = "blocks"): ParsedAll<PrimitiveBlock[]> {
  const ctx: Ctx = { errors: [] };
  if (!Array.isArray(v)) return noAll([`${at}: expected an array of blocks`]);

  const blocks = v.flatMap((node, i) => {
    const block = parseBlock(node, `${at}[${i}]`, ctx);
    return block === undefined ? [] : [block];
  });

  if (ctx.errors.length > 0) return noAll(ctx.errors);

  // Two fields sharing an id means one answer silently overwrites the other, and
  // the loss is invisible in the rendered page. Caught here, once.
  const seen = new Set<string>();
  const duplicates = blocks
    .flatMap((b) => (b.kind === "field" ? [b.spec.id] : []))
    .filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  if (duplicates.length > 0) return noAll([`${at}: duplicate field ids: ${[...new Set(duplicates)].join(", ")}`]);

  return okAll(blocks);
}

export { parseFieldSpec };
