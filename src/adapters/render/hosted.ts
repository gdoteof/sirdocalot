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
      const { brief, participation } = view;
      const collecting = fieldsOf(brief.blocks).length > 0;
      const answering = participation?.state === "answering";

      // Answers already given are rendered into the same controls that collected
      // them, disabled. A respondent checking what they said should see the
      // question they said it under, not a list of values.
      const body = renderBlocks(brief.blocks, {
        interactive: answering,
        values: participation?.values ?? {},
        errors: participation?.state === "answering" ? participation.errors : {},
      });

      const inner =
        participation?.state === "answering"
          ? `<form method="post" action="${escapeHtml(participation.action)}" novalidate>
               ${body}
               <div class="actions">
                 <button type="submit">Submit</button>
                 <span class="note">Answering as ${escapeHtml(participation.participant.name)}</span>
               </div>
             </form>`
          : participation?.state === "answered"
            ? `${body}
               <p class="note">Answered by ${escapeHtml(participation.participant.name)} on ${escapeHtml(
                 submittedOn(participation.submittedAt),
               )}.</p>`
            : body + (view.results !== undefined ? renderBlocks(resultBlocks(view.results, brief.participants)) : "");

      return page(brief.title, brief.intent.purpose, collecting, view, inner);
    },
  };
}

// The stored timestamp is an instant; what a respondent wants from it is the day
// they answered. Rendered in UTC so the page does not claim a timezone it cannot
// know from a server.
function submittedOn(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : `${at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} at ${at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
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
