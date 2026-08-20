// The Claude artifact target: one self-contained document, no form, no host.
//
// Same blocks, same stylesheet. What differs is only the wrapper -- this one
// emits a fragment the artifact runtime wraps itself, and it never offers an
// input, because there is nowhere for an answer to go.

import type { Renderer, RenderView } from "../../application/ports.ts";
import { escapeHtml, renderBlocks } from "./blocks.ts";
import { resultBlocks } from "./results.ts";
import { STYLE } from "./style.ts";

export function artifactRenderer(): Renderer {
  return {
    render(view: RenderView): string {
      const { brief } = view;
      const results = view.results !== undefined ? renderBlocks(resultBlocks(view.results, brief.participants)) : "";

      // No <html>, <head> or <body>: the artifact host supplies that skeleton and
      // a page that brings its own gets it twice. The <title> is read from the
      // first 8KB, so it leads.
      return `<title>${escapeHtml(brief.title)}</title>
<style>${STYLE}</style>
<main class="page">
  <header class="masthead">
    <p class="eyebrow">Prepared by an agent</p>
    <h1 class="title">${escapeHtml(brief.title)}</h1>
    <p class="byline">${escapeHtml(brief.intent.purpose)}</p>
  </header>
  ${renderBlocks(brief.blocks)}
  ${results}
</main>`;
    },
  };
}
