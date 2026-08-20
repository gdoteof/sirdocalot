// Primitive blocks to HTML. Target-agnostic on purpose: if this file ever needs
// to know whether it is rendering a hosted page or a Claude artifact, the port is
// wrong and the difference belongs in the wrapper, not here.

import type { Answer, FieldSpec } from "../../domain/fields.ts";
import type { PrimitiveBlock } from "../../domain/primitives.ts";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type FieldContext = {
  // Absent means read-only: the artifact target and the closed-brief view both
  // show the questions without offering a way to answer them.
  interactive: boolean;
  values: Record<string, Answer>;
  errors: Record<string, string>;
};

const READ_ONLY: FieldContext = { interactive: false, values: {}, errors: {} };

export function renderBlocks(blocks: readonly PrimitiveBlock[], ctx: FieldContext = READ_ONLY): string {
  return blocks.map((block) => renderBlock(block, ctx)).join("\n");
}

function renderBlock(block: PrimitiveBlock, ctx: FieldContext): string {
  switch (block.kind) {
    case "heading":
      return `<h${block.level} class="h">${escapeHtml(block.text)}</h${block.level}>`;
    case "prose":
      return `<p class="prose">${paragraphs(block.text)}</p>`;
    case "callout":
      return [
        `<div class="callout callout-${block.tone}">`,
        block.title !== undefined ? `<div class="callout-title">${escapeHtml(block.title)}</div>` : "",
        `<div>${paragraphs(block.text)}</div>`,
        `</div>`,
      ].join("");
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return `<${tag} class="list">${block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</${tag}>`;
    }
    case "keyValue":
      return `<dl class="kv">${block.entries
        .map((e) => `<dt>${escapeHtml(e.key)}</dt><dd>${escapeHtml(e.value)}</dd>`)
        .join("")}</dl>`;
    case "table":
      return [
        `<div class="table-wrap"><table>`,
        `<thead><tr>${block.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`,
        `<tbody>${block.rows
          .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody>`,
        `</table></div>`,
        block.caption !== undefined ? `<p class="caption">${escapeHtml(block.caption)}</p>` : "",
      ].join("");
    case "code":
      return `<pre class="code"><code>${escapeHtml(block.text)}</code></pre>`;
    case "divider":
      return `<hr class="rule" />`;
    case "field":
      return renderField(block.spec, ctx);
    case "raw":
      // Tier three runs in a sandbox with no scripts, no same-origin access and
      // no forms. An agent-authored escape hatch is exactly the content that must
      // not be able to read the page it was dropped into.
      return `<iframe class="raw" sandbox="" srcdoc="${escapeHtml(block.html)}" title="custom content"></iframe>`;
  }
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => escapeHtml(p).replace(/\n/g, "<br />"))
    .join("</p><p class=\"prose\">");
}

function renderField(spec: FieldSpec, ctx: FieldContext): string {
  const value = ctx.values[spec.id];
  const error = ctx.errors[spec.id];
  const disabled = ctx.interactive ? "" : " disabled";
  const required = spec.required ? " required" : "";
  const name = escapeHtml(spec.id);

  const control = ((): string => {
    switch (spec.kind) {
      case "text":
        return spec.long === true
          ? `<textarea id="${name}" name="${name}" rows="4"${required}${disabled}>${escapeHtml(String(value ?? ""))}</textarea>`
          : `<input id="${name}" name="${name}" type="text" value="${escapeHtml(String(value ?? ""))}"${required}${disabled} />`;
      case "number":
        return `<input id="${name}" name="${name}" type="number" step="any" value="${escapeHtml(String(value ?? ""))}"${
          spec.min !== undefined ? ` min="${spec.min}"` : ""
        }${spec.max !== undefined ? ` max="${spec.max}"` : ""}${required}${disabled} />`;
      case "boolean":
        return `<label class="check"><input type="checkbox" name="${name}" value="true"${
          value === true ? " checked" : ""
        }${disabled} /> <span>Yes</span></label>`;
      case "choice": {
        const picked = new Set(Array.isArray(value) ? value : value === undefined ? [] : [String(value)]);
        const type = spec.multiple ? "checkbox" : "radio";
        return `<div class="choices">${spec.options
          .map(
            (o) =>
              `<label class="check"><input type="${type}" name="${name}" value="${escapeHtml(o.value)}"${
                picked.has(o.value) ? " checked" : ""
              }${disabled} /> <span>${escapeHtml(o.label)}</span></label>`,
          )
          .join("")}</div>`;
      }
      case "rating": {
        const current = typeof value === "number" ? value : 0;
        const steps = Array.from({ length: spec.scale }, (_, i) => i + 1);
        return `<div class="rating">${steps
          .map(
            (n) =>
              `<label class="pip"><input type="radio" name="${name}" value="${n}"${
                current === n ? " checked" : ""
              }${disabled} /><span>${n}</span></label>`,
          )
          .join("")}</div>`;
      }
    }
  })();

  return [
    `<div class="field${error !== undefined ? " field-error" : ""}">`,
    `<label class="label" for="${name}">${escapeHtml(spec.label)}${spec.required ? '<span class="req">*</span>' : ""}</label>`,
    spec.help !== undefined ? `<p class="help">${escapeHtml(spec.help)}</p>` : "",
    control,
    error !== undefined ? `<p class="error">${escapeHtml(error)}</p>` : "",
    `</div>`,
  ].join("");
}
