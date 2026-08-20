// The shareable page: what a participant opens, and where their answers are
// typed. Server-rendered with a plain form -- no client bundle, because a form
// that needs JavaScript to submit is a form that fails for someone.

import type { Renderer, RenderView } from "../../application/ports.ts";
import { fieldsOf } from "../../domain/primitives.ts";
import { escapeHtml, renderBlocks } from "./blocks.ts";
import { resultBlocks } from "./results.ts";
import { STYLE } from "./style.ts";

export function hostedRenderer(): Renderer {
  return {
    render(view: RenderView): string {
      const { brief, form } = view;
      const collecting = fieldsOf(brief.blocks).length > 0;

      const body = renderBlocks(
        brief.blocks,
        form !== undefined
          ? { interactive: true, values: form.values, errors: form.errors }
          : { interactive: false, values: {}, errors: {} },
      );

      const inner =
        form !== undefined
          ? `<form method="post" action="${escapeHtml(form.action)}" novalidate>
               ${body}
               <div class="actions">
                 <button type="submit">Submit</button>
                 <span class="note">Answering as ${escapeHtml(form.participant.name)}</span>
               </div>
             </form>`
          : body + (view.results !== undefined ? renderBlocks(resultBlocks(view.results, brief.participants)) : "");

      return page(brief.title, brief.intent.purpose, collecting, view, inner);
    },
  };
}

function page(
  title: string,
  purpose: string,
  collecting: boolean,
  view: RenderView,
  inner: string,
): string {
  const banner =
    view.banner !== undefined
      ? `<div class="banner"><strong>${escapeHtml(view.banner.title)}</strong><p>${escapeHtml(view.banner.body)}</p></div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    <p class="eyebrow">${collecting ? "Requested by an agent" : "Prepared by an agent"}</p>
    <h1 class="title">${escapeHtml(title)}</h1>
    <p class="byline">${escapeHtml(purpose)}</p>
  </header>
  ${banner}
  ${inner}
  <p class="footer">sirdocalot</p>
</main>
</body>
</html>`;
}
