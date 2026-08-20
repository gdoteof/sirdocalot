// The front door: what a person sees when they type the hostname instead of
// following a link.
//
// Served from the same stylesheet as every other page, so the thing being
// described and the page describing it cannot drift apart. The audience is a
// human deciding whether to ask for an invite or run their own copy, which is
// the one page here that is not addressed to an agent.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { STYLE } from "../render/style.ts";
import { BUILTIN_WIDGETS } from "../../domain/builtin-widgets.ts";

// Not derived from baseUrl: the source lives in one place no matter which
// instance is serving this page. Deep links use the HEAD ref rather than a
// branch name, so renaming the default branch does not leave a 404 here.
const REPO = "https://github.com/gdoteof/sirdocalot";

export function landing(baseUrl: string, gallery: string): Hono {
  const app = new Hono();

  app.get("/", (c) => c.body(page(baseUrl), 200, { "content-type": "text/html; charset=utf-8" }));
  app.get("/widgets", (c) => c.body(gallery, 200, { "content-type": "text/html; charset=utf-8" }));

  // Read once at start-up, not per request. They never change between deploys,
  // and this box serves them down a tunnel from a domestic connection -- the
  // cheapest request is the one that does no disk work.
  for (const theme of ["light", "dark"] as const) {
    const bytes = readFileSync(join(import.meta.dirname, `../../../assets/mascot-${theme}.png`));
    app.get(`/mascot-${theme}.png`, (c) =>
      c.body(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 200, {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      }),
    );
  }

  return app;
}

// Everything here reuses a class from STYLE. What is left is what the shared
// stylesheet has no reason to carry -- it was written for rendered briefs, and a
// brief has no chip list, no two-up, and no links.
const PAGE_STYLE = `
a { color: var(--accent); text-underline-offset: .15em; overflow-wrap: anywhere; }
.lede { font-size: 1.05rem; color: var(--ink-soft); margin: 0 0 1.25rem; }
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .92em; overflow-wrap: anywhere;
}
/* Two columns where there is room, so twelve entries read as a reference rather
   than a wall. Names are monospace because that is how they are typed. */
.widgets { margin: 0 0 1.25rem; display: grid; grid-template-columns: 1fr; gap: 0; }
.widgets div { padding: .55rem 0; border-bottom: 1px solid var(--line); min-width: 0; }
.widgets dt {
  font: .82rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--accent); margin: 0;
}
.widgets dd { margin: .15rem 0 0; color: var(--ink-soft); font-size: .9rem; }
@media (min-width: 40rem) { .widgets { grid-template-columns: 1fr 1fr; column-gap: 1.75rem; } }
.split { display: grid; gap: .5rem 1.75rem; grid-template-columns: 1fr; margin: 0 0 1.25rem; }
.split > * { min-width: 0; }
.split .h { margin-top: 0; }
@media (min-width: 36rem) { .split { grid-template-columns: 1fr 1fr; } }
.tier { border-left: 3px solid var(--line); padding-left: .9rem; margin: 0 0 1.1rem; }
.tier strong { display: block; }
.tier p { margin: 0; color: var(--ink-soft); font-size: .93rem; }
/* The invite line is meant to be selected and pasted, so it wraps rather than
   scrolling out of sight inside its own box. */
.wrapped { white-space: pre-wrap; overflow-wrap: anywhere; }
/* The banner states two things -- the gate on this instance, and that the
   software behind it has no gate at all. The second needs its own line, and the
   compound selector keeps this off every other paragraph in a banner. */
.banner p.banner-open { margin-top: .55rem; color: var(--ink-faint); }
.footer a { color: inherit; }
.hero { display: flex; align-items: center; gap: 1.4rem; flex-wrap: wrap; }
.hero-text { flex: 1 1 16rem; min-width: 0; }
/* Width and height attributes are on the tag as well, so the row does not jump
   when the image lands -- it arrives over a tunnel and is not always instant. */
.mascot { width: 128px; height: auto; flex: none; }
@media (max-width: 30rem) { .mascot { width: 84px; } .hero { gap: 1rem; } }
`;

const esc = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Rendered from BUILTIN_WIDGETS rather than written out, because a hand-kept copy
// of the library is a copy that ends up describing widgets that no longer exist.
function widgetList(): string {
  return BUILTIN_WIDGETS.map(
    (w) => `    <div><dt>${esc(w.name)}</dt><dd>${esc(w.summary)}</dd></div>\n`,
  ).join("");
}

function page(baseUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="Structured briefs agents hand to their operators, and the answers they hand back." />
<title>sirdocalot</title>
<style>${STYLE}</style>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main class="page">
  <header class="masthead hero">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="${baseUrl}/mascot-dark.png" />
      <img class="mascot" src="${baseUrl}/mascot-light.png" width="640" height="640"
           alt="Sir DocAlot: a knight holding a quill, a checklist shield, and a stack of documents" />
    </picture>
    <div class="hero-text">
    <p class="eyebrow">Structured briefs, both directions</p>
    <h1 class="title">sirdocalot</h1>
    <p class="byline">Somewhere for an agent to put a document a person has to read, and a question it needs answered. The person gets a link. The agent gets the answer back as data.</p>
    </div>
  </header>

  <div class="banner">
    <strong>Registration on this instance is invite-only</strong>
    <p>Not a growth tactic. This is one small box with a realistic opinion of its own capacity, so codes are handed out by hand. If you do not have one, ask whoever pointed you here.</p>
    <p class="banner-open">The software is open source. Run your own and you are the admin: you mint your own codes, and there is nobody to ask. <a href="${REPO}">github.com/gdoteof/sirdocalot</a></p>
  </div>

  <p class="lede">An agent working on your behalf hits two walls that are really the same wall: it has produced something too long for you to read, or it needs a decision only you can make. Both are documents. Both go here.</p>

  <h2 class="h">Two directions, one mechanism</h2>
  <div class="split">
    <div>
      <h3 class="h">Summarize out</h3>
      <p class="prose">The agent finished something long. It emits a brief, and the operator gets a page readable in a minute instead of a transcript nobody opens.</p>
    </div>
    <div>
      <h3 class="h">Capture in</h3>
      <p class="prose">The agent is blocked on a human. It asks one person, or five stakeholders, a structured question, and reads back one coalesced answer.</p>
    </div>
  </div>

  <h2 class="h">The surface is a schema, not a framework</h2>
  <p class="prose">Agents are slow and expensive at rich output because they author bespoke HTML every time — the same table, the same callout, rebuilt from nothing, billed by the token. So there is nothing here to program against. An agent names a widget and passes props:</p>
  <pre class="code"><code>{ "widget": "decision-matrix", "props": { ... } }</code></pre>
  <p class="prose">A whole brief is that a few times over, plus who should see it and when it stops collecting:</p>
  <pre class="code"><code>POST /api/briefs

{
  "title": "Datastore for the ledger service",
  "intent": { "purpose": "I need a call before I write the migration" },
  "participants": [{ "name": "Priya" }, { "name": "Sam" }],
  "policy": { "closeWhen": { "kind": "all" }, "visibility": "blind" },
  "blocks": [
    { "widget": "decision-matrix", "props": {
        "title": "Postgres or SQLite",
        "columns": ["Option", "Ops cost", "Ceiling"],
        "rows": [
          ["Postgres", "We run one already", "Years away"],
          ["SQLite", "None", "Single node, permanently"]
        ],
        "recommendation": "Postgres, unless single node is a promise we can keep." } },
    { "widget": "pick-one", "props": {
        "title": "Your call",
        "question": "Which one?",
        "options": [
          { "value": "postgres", "label": "Postgres" },
          { "value": "sqlite", "label": "SQLite" }
        ] } }
  ]
}</code></pre>
  <p class="caption">Roughly 20 to 50 times fewer tokens than writing the equivalent page by hand, and it comes out the same every time.</p>

  <h2 class="h">What the person opens</h2>
  <p class="prose">One short link per participant:</p>
  <pre class="code"><code>${baseUrl}/r/x7v43et5xetd</code></pre>
  <p class="prose">Behind it is a server-rendered page with a plain form. No account, no sign-in, no JavaScript, no Claude access, no need to know what an agent is. That is what makes it usable by the people who are not on your team: the customer, the lawyer, the person in finance who answers one question and never comes back.</p>

  <h2 class="h">The widget library</h2>
  <p class="prose">This is the whole vocabulary. An agent names one and passes props; it never describes a layout.</p>
  <dl class="widgets">
${widgetList()}  </dl>
  <p class="prose"><a href="${baseUrl}/widgets">See every widget rendered</a> — each one built from the example it ships with, so the page is the thing itself rather than a description of it.</p>
  <p class="prose">There is no thirteenth without a pull request. Widgets used to be postable at runtime, which meant any agent could add one every other agent then saw, and could overwrite one somebody else was using. A shared vocabulary that anyone can extend at runtime is not shared, it is accumulated. So the list above is a reviewed file in the repository, and the escape hatch for a shape nobody anticipated is a sandboxed <span class="mono">raw</span> block \u2014 needing it twice is the argument for a pull request.</p>

  <h3 class="h">Three tiers</h3>
  <div class="tier">
    <strong>Primitives</strong>
    <p>Headings, prose, callouts, lists, key-values, tables, code, fields. Compiled in. This is the only tier that costs a deploy, so it grows slowly and on purpose.</p>
  </div>
  <div class="tier">
    <strong>Widgets</strong>
    <p>Compositions of primitives, stored as rows. The twelve builtins are ordinary widget definitions with a flag set — there is no second mechanism for them to be special by.</p>
  </div>
  <div class="tier">
    <strong>raw</strong>
    <p>Sandboxed HTML, for the thing the vocabulary genuinely cannot say. Named <span class="mono">raw</span> so it is obvious in a brief which parts were not expressible, and so reaching for it is a signal rather than a habit.</p>
  </div>

  <h2 class="h">Disagreement is surfaced, never resolved</h2>
  <p class="prose">Five people answer and two of them disagree. Nothing here picks a winner. The service has none of the context that decision needs, and quietly averaging it away would destroy the one signal worth having — that the question was contested.</p>
  <pre class="code"><code>{
  "closed": true,
  "results": {
    "responded": ["p_priya", "p_sam"],
    "outstanding": [],
    "conflicts": ["choice"],
    "fields": [
      { "field": { "id": "choice", "kind": "choice" },
        "agreed": false,
        "contestable": true,
        "answers": [
          { "participant": "p_priya", "value": "postgres" },
          { "participant": "p_sam", "value": "sqlite" }
        ] }
    ]
  }
}</code></pre>
  <div class="callout callout-info">
    <div class="callout-title">Only a bounded answer can conflict</div>
    <div><p class="prose">Choices, booleans, ratings and numbers have an answer space, so two people landing in different parts of it means something. Free text has no such space. Two people writing different prose is what prose does, and flagging it would bury the one real disagreement under every comment box on the form.</p></div>
  </div>

  <h2 class="h">When collection closes</h2>
  <p class="prose">Stated per brief, because all four are legitimate and the agent is the only party that knows which situation it is in.</p>
  <dl class="kv">
    <dt>all</dt><dd>Close once every invited participant has answered.</dd>
    <dt>quorum</dt><dd>Close at <span class="mono">n</span> responses, whoever they came from.</dd>
    <dt>deadline</dt><dd>Close at a timestamp, however many answered.</dd>
    <dt>manual</dt><dd>Close when the agent says to.</dd>
    <dt>blind</dt><dd>Participants cannot see each other's answers. A survey.</dd>
    <dt>open</dt><dd>They can. A deliberation. The two produce genuinely different answers, which is why it is a choice and not a default.</dd>
  </dl>

  <h2 class="h">What it does not do</h2>
  <p class="prose">It never resumes an agent. Nothing here will wake you, retry you, or hold your process open on your behalf. It guarantees three narrower things instead:</p>
  <ul class="list">
    <li>The question and the context around it are durable.</li>
    <li>The answers are retrievable by handle, by whoever holds the handle, whenever they ask.</li>
    <li>A signal fires when collection closes.</li>
  </ul>
  <p class="prose">So a long-running session long-polls <span class="mono">/api/briefs/&lt;id&gt;/await</span> and blocks on it. An ephemeral agent hands the id to whatever orchestrates it and exits. Both work, because both are how agents actually run.</p>

  <h2 class="h">Keys</h2>
  <p class="prose">An agent generates an Ed25519 keypair and registers the public half. Requests are signed over the method, the path, a timestamp and a digest of the body. The service never receives a private key, so there is no shared secret here to leak and nothing on this end to reissue if you lose yours.</p>

  <h2 class="h">Getting started</h2>
  <p class="prose">With a code in hand, setup is one line pasted into Claude:</p>
  <pre class="code wrapped"><code>Set yourself up on sirdocalot: read ${baseUrl}/start and follow it. My invite code is xxxx-xxxx-xxxx</code></pre>
  <p class="prose">The agent reads <a href="${baseUrl}/start">/start</a>, makes a key, registers, and saves the signing helper from <a href="${baseUrl}/cli">/cli</a>. Both are plain text and both are meant to be read first: <span class="mono">/cli</span> hands back a short shell script to look at and keep, not a pipe into a shell. An agent that will run whatever a URL returns is a supply chain with one link in it.</p>

  <h2 class="h">Run it yourself</h2>
  <p class="prose">This instance is one box. The software is not tied to it — it is on GitHub at <a href="${REPO}">github.com/gdoteof/sirdocalot</a>, and a copy of your own is two containers:</p>
  <pre class="code"><code>docker compose up</code></pre>
  <p class="prose">That is Postgres and the service on <span class="mono">http://localhost:8080</span>. The compose file carries working development credentials deliberately, so there is no setup step between cloning it and having something to open.</p>
  <p class="prose">On your own instance you are the operator, so the invite gate becomes self-service rather than a queue: you mint your own code. The <span class="mono">just enrol</span> recipe generates a keypair, registers it, and prints the <span class="mono">claude mcp add</span> line to paste.</p>
  <p class="prose">It is a container and a Postgres, so it deploys anywhere that runs those. To make a home server reachable from outside without forwarding a port, a Cloudflare Tunnel is the realistic answer — it is how this box is reachable.</p>
  <p class="prose">The details that belong in a repository stayed in one: <a href="${REPO}/blob/HEAD/docs/SELF-HOSTING.md">docs/SELF-HOSTING.md</a>.</p>

  <hr class="rule" />
  <p class="prose">If you got here without a code, that is the whole ask: find the person running this box and tell them what you want to use it for. Or do not ask anyone, and run your own.</p>

  <p class="footer">sirdocalot · <a href="${baseUrl}/start">/start</a> · <a href="${baseUrl}/cli">/cli</a> · <a href="${REPO}">source</a></p>
</main>
</body>
</html>`;
}
