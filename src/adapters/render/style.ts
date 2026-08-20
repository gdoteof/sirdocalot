// One stylesheet, inlined into every page.
//
// No external font or asset host. The hosted pages are served to stakeholders on
// unknown networks and the artifact target runs under a strict CSP, so a design
// that needs a CDN is a design that renders differently in the two places it has
// to look the same.

export const STYLE = `
:root {
  --bg: #fbfaf8;
  --surface: #ffffff;
  --ink: #1c1b1a;
  --ink-soft: #55524e;
  --ink-faint: #8a8580;
  --line: #e4e0da;
  --accent: #7a5c3e;
  --accent-soft: #f3ece4;
  --info: #3f5f7a; --info-bg: #eef3f7;
  --warn: #8a6420; --warn-bg: #faf3e6;
  --success: #3f6b4a; --success-bg: #edf4ee;
  --danger: #8c3b34; --danger-bg: #faeeed;
  --radius: 6px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #17161a; --surface: #1f1e23; --ink: #eceaf0; --ink-soft: #b3aeb8;
    --ink-faint: #7e7986; --line: #33313a; --accent: #c9a87e; --accent-soft: #2a2630;
    --info: #9dc0dc; --info-bg: #22262e;
    --warn: #dcb877; --warn-bg: #2b2620;
    --success: #97c9a6; --success-bg: #1f2a23;
    --danger: #e0938c; --danger-bg: #2d2121;
  }
}
:root[data-theme="dark"] {
  --bg: #17161a; --surface: #1f1e23; --ink: #eceaf0; --ink-soft: #b3aeb8;
  --ink-faint: #7e7986; --line: #33313a; --accent: #c9a87e; --accent-soft: #2a2630;
  --info: #9dc0dc; --info-bg: #22262e;
  --warn: #dcb877; --warn-bg: #2b2620;
  --success: #97c9a6; --success-bg: #1f2a23;
  --danger: #e0938c; --danger-bg: #2d2121;
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.page { max-width: 44rem; margin: 0 auto; padding: 3rem 1.25rem 5rem; }
.masthead { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 2rem; }
.eyebrow {
  font-size: .7rem; letter-spacing: .12em; text-transform: uppercase;
  color: var(--ink-faint); margin: 0 0 .4rem;
}
.title { font-size: 1.9rem; line-height: 1.2; margin: 0; letter-spacing: -.02em; font-weight: 620; }
.byline { color: var(--ink-soft); font-size: .9rem; margin: .5rem 0 0; }

.h { line-height: 1.25; letter-spacing: -.015em; margin: 2.2rem 0 .75rem; font-weight: 600; }
h1.h { font-size: 1.6rem; } h2.h { font-size: 1.25rem; } h3.h { font-size: 1.05rem; }
.h:first-child { margin-top: 0; }
.prose { margin: 0 0 1rem; color: var(--ink-soft); }
.list { margin: 0 0 1.15rem; padding-left: 1.25rem; color: var(--ink-soft); }
.list li { margin: .3rem 0; }
.rule { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
.caption { font-size: .82rem; color: var(--ink-faint); margin: .5rem 0 1.25rem; }

.callout {
  border-left: 3px solid var(--info); background: var(--info-bg);
  padding: .85rem 1rem; border-radius: 0 var(--radius) var(--radius) 0; margin: 0 0 1.25rem;
}
.callout .prose { color: inherit; margin: 0; }
.callout-title { font-weight: 600; margin-bottom: .25rem; font-size: .95rem; }
.callout-info { border-color: var(--info); background: var(--info-bg); color: var(--info); }
.callout-warn { border-color: var(--warn); background: var(--warn-bg); color: var(--warn); }
.callout-success { border-color: var(--success); background: var(--success-bg); color: var(--success); }
.callout-danger { border-color: var(--danger); background: var(--danger-bg); color: var(--danger); }

.kv { margin: 0 0 1.25rem; display: grid; grid-template-columns: minmax(7rem, auto) 1fr; gap: .1rem 1rem; }
.kv dt { color: var(--ink-faint); font-size: .85rem; padding: .35rem 0; border-bottom: 1px solid var(--line); }
.kv dd { margin: 0; padding: .35rem 0; border-bottom: 1px solid var(--line); }

.table-wrap { overflow-x: auto; margin: 0 0 1.25rem; }
table { border-collapse: collapse; width: 100%; font-size: .92rem; }
th, td { text-align: left; padding: .55rem .7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; }
tbody tr:last-child td { border-bottom: 0; }

.code {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: .85rem 1rem; overflow-x: auto; margin: 0 0 1.25rem;
  font: .85rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.raw { width: 100%; min-height: 12rem; border: 1px dashed var(--line); border-radius: var(--radius); background: var(--surface); }

.field {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 1rem 1.1rem; margin: 0 0 1rem;
}
.field-error { border-color: var(--danger); }
.label { display: block; font-weight: 580; margin-bottom: .3rem; }
.req { color: var(--danger); margin-left: .15rem; }
.help { color: var(--ink-faint); font-size: .85rem; margin: 0 0 .6rem; }
.error { color: var(--danger); font-size: .85rem; margin: .5rem 0 0; }
input[type=text], input[type=number], textarea {
  width: 100%; font: inherit; color: inherit; background: var(--bg);
  border: 1px solid var(--line); border-radius: var(--radius); padding: .5rem .65rem;
}
input[type=text]:focus, input[type=number]:focus, textarea:focus {
  outline: 2px solid var(--accent); outline-offset: 1px; border-color: transparent;
}
textarea { resize: vertical; }
.choices { display: grid; gap: .4rem; }
.check { display: flex; align-items: flex-start; gap: .5rem; cursor: pointer; }
.check input { margin-top: .35rem; }
.rating { display: flex; gap: .4rem; flex-wrap: wrap; }
.pip { cursor: pointer; }
.pip input { position: absolute; opacity: 0; width: 0; height: 0; }
.pip span {
  display: grid; place-items: center; width: 2.2rem; height: 2.2rem;
  border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); font-size: .9rem;
}
.pip input:checked + span { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 600; }
.pip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }

.actions { display: flex; align-items: center; gap: 1rem; margin-top: 1.75rem; }
button {
  font: inherit; font-weight: 580; cursor: pointer; padding: .6rem 1.4rem;
  background: var(--accent); color: var(--bg); border: 0; border-radius: var(--radius);
}
button:hover { filter: brightness(1.08); }
button:disabled { opacity: .5; cursor: not-allowed; }
.note { color: var(--ink-faint); font-size: .85rem; }

.banner {
  border: 1px solid var(--line); background: var(--surface); border-radius: var(--radius);
  padding: 1rem 1.15rem; margin: 0 0 2rem;
}
.banner strong { display: block; margin-bottom: .2rem; }
.banner p { margin: 0; color: var(--ink-soft); font-size: .92rem; }
.footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--ink-faint); font-size: .8rem; }
[disabled], :disabled { opacity: .75; }
`;
