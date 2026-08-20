// Every widget, rendered.
//
// The landing page lists names and summaries, which tells a reader what exists
// and nothing about what it looks like. This renders each widget from the example
// it carries, through the same block renderer the real pages use -- so what is on
// this page is what an operator gets, not an impression of it. If a widget breaks,
// it breaks here in the open rather than in somebody's brief.

import { BUILTIN_WIDGETS } from "../../domain/builtin-widgets.ts";
import { parseBlocks } from "../../domain/parse.ts";
import { expand } from "../../domain/widget.ts";
import type { WidgetDef } from "../../domain/widget.ts";
import { escapeHtml, renderBlocks } from "./blocks.ts";
import { STYLE } from "./style.ts";

const GALLERY_STYLE = `
a { color: var(--accent); text-underline-offset: .15em; }
.index { display: flex; flex-wrap: wrap; gap: .4rem; list-style: none; padding: 0; margin: 0 0 2.5rem; }
.index a {
  display: block; text-decoration: none;
  font: .78rem/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--ink-soft); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--radius); padding: .3rem .5rem;
}
.index a:hover { border-color: var(--accent); color: var(--accent); }
.entry { margin: 0 0 3.5rem; scroll-margin-top: 1rem; }
.entry > h2 {
  font: 600 1.05rem/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--accent); margin: 0 0 .3rem;
}
.entry > .summary { color: var(--ink-soft); margin: 0 0 1rem; }
/* Not .label. The block renderer uses that class for field labels, so styling
   it here restyled every input inside a preview -- the previews were showing
   something a real brief never looks like, which is the one thing this page
   must not do. Anything added here has to avoid the names in style.ts. */
.caption-above { margin: 1.25rem 0 .5rem; }
/* The preview carries its own ground so a rendering is visibly a rendering and
   not more page. Padding rather than a card, because the widgets already bring
   their own boxes and nesting them looks like a mistake. */
.preview {
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 1.1rem 1.2rem .4rem; background: var(--bg);
}
.preview .h:first-child { margin-top: 0; }
.props { font-size: .85rem; }
.props code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--accent); }
/* Not .req either -- style.ts uses that for the asterisk on a required
   field label, and a preview must look exactly like the real thing. */
.needed { color: var(--danger); }
.back { display: inline-block; margin-bottom: 2rem; font-size: .9rem; }
`;

function propsTable(widget: WidgetDef): string {
  if (widget.props.length === 0) return "";
  return `<div class="table-wrap"><table class="props">
    <thead><tr><th>Prop</th><th>Type</th><th>Required</th><th></th></tr></thead>
    <tbody>${widget.props
      .map(
        (p) =>
          `<tr><td><code>${escapeHtml(p.name)}</code></td><td>${escapeHtml(p.type)}</td>` +
          `<td>${p.required ? '<span class="needed">yes</span>' : "no"}</td>` +
          `<td>${escapeHtml(p.description ?? "")}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

function entry(widget: WidgetDef): string {
  const emitted = JSON.stringify({ widget: widget.name, props: widget.example }, null, 2);
  const parsed = parseBlocks(expand(widget, widget.example));

  // A widget whose own example does not render is a broken widget, and saying so
  // here is more useful than an empty box. The test suite makes this unreachable;
  // the page should not pretend otherwise if it ever is not.
  const preview = parsed.ok
    ? renderBlocks(parsed.value)
    : `<p class="prose">This widget did not render: ${escapeHtml(parsed.errors.join("; "))}</p>`;

  return `<section class="entry" id="${escapeHtml(widget.name)}">
  <h2>${escapeHtml(widget.name)}</h2>
  <p class="summary">${escapeHtml(widget.summary)}</p>
  ${propsTable(widget)}
  <p class="eyebrow caption-above">What the agent emits</p>
  <pre class="code"><code>${escapeHtml(emitted)}</code></pre>
  <p class="eyebrow caption-above">What the operator sees</p>
  <div class="preview">${preview}</div>
</section>`;
}

export function galleryPage(baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Every sirdocalot widget, rendered from the example it ships with." />
<title>Widget library — sirdocalot</title>
<style>${STYLE}</style>
<style>${GALLERY_STYLE}</style>
</head>
<body>
<main class="page">
  <a class="back" href="${baseUrl}/">← sirdocalot</a>
  <header class="masthead">
    <p class="eyebrow">The whole vocabulary</p>
    <h1 class="title">Widget library</h1>
    <p class="byline">${BUILTIN_WIDGETS.length} widgets, each rendered from the example it ships with. An agent names one and passes props; everything below is what that produces. Input widgets are shown disabled — on a real brief they are a working form.</p>
  </header>

  <ul class="index">
    ${BUILTIN_WIDGETS.map((w) => `<li><a href="#${escapeHtml(w.name)}">${escapeHtml(w.name)}</a></li>`).join("\n    ")}
  </ul>

  ${BUILTIN_WIDGETS.map(entry).join("\n\n")}

  <p class="footer">There is no thirteenth without a pull request. <a href="${baseUrl}/start">Set up an agent</a>.</p>
</main>
</body>
</html>`;
}
