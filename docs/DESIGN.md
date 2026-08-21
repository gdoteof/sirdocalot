# sirdocalot — design

Status: **deployed** at https://sirdocalot.vteng.io, on the gtr k3s cluster.
Open questions are marked `OPEN`.

## What this is

A service agents use to hand rich, structured documents to their operators — and,
when the document asks for something back, to collect answers from one or more
people and make those answers durably retrievable.

Two directions, one mechanism:

- **Summarize-out** — turn a wall of text into something legible. Read-only.
- **Capture-in** — ask the operator, or several stakeholders, a structured
  question and collect the answers.

These are not two products. The only difference is whether a document's widgets
declare a response schema. Same registry, same render pipeline, same storage.

## The core bet: a schema, not a framework

Handing work to a person by authoring a page costs thousands of output tokens
every time, and leaves the whole page behind in the session that wrote it. So the
agent-facing surface is a **schema it emits against**, not a framework it programs
against:

```json
{"type": "decision-matrix", "options": [...], "criteria": [...]}
```

Any design decision that pushes agents back toward writing markup has broken the
bet.

`MEASURED 2026-08-20.` The saving is real and it is in the *path*, not in the
markup — which is not where it was expected to be, and is worth writing down.

Compare the two generations alone and there is almost nothing in it: both arms
write the same prose, and only one also writes the tags around it. Markup is the
minority of an authored page, so a schema that removes it saves little.

Compare the two *paths* end to end and the gap opens. One session forked twice,
each fork asked to hand the same work to a person: composing a brief cost 2.4×
less output, grew the session context 3.5× less, and finished about 2.9× faster
than authoring and publishing a page ([the runs](https://sirdocalot.vteng.io/bench)). That path loads a design
skill, writes a file, publishes it, and carries the whole page back through the
transcript.

Context growth is the one to watch, because it is the cost that compounds: every
later turn in that session re-reads what the handover left behind.

See [`/bench`](https://sirdocalot.vteng.io/bench) and `bench/README.md` for the runs and the caveats.

## Vocabulary

One name per concept, used identically in the core and at every edge.

| Term | Meaning |
| --- | --- |
| **Brief** | The document an agent emits. Composed of widgets. Has zero or more inputs. |
| **Primitive** | A compiled-in building block: layout, prose, table, chart, input controls. Curated, small, changes rarely. |
| **Widget** | A named composition of primitives, stored as data. Declares a props schema, and — if it collects — a response schema. |
| **Participant** | A person invited to respond, holding one signed link. |
| **Response** | One participant's answers to one brief. |
| **Collection policy** | What "done collecting" means for this brief. |
| **Intent** | What the requesting agent meant to do with the answers. Carried so an orchestrator can act without the original session. |
| **Handle** | The durable id by which a brief and its responses are retrieved. |

`Brief`, not "artifact": we render to Claude Artifacts as one of two targets, and
two meanings for one word in the same codebase is how the translation tax starts.

Decided. "Artifact" stays reserved for the Claude artifact target, which is one
of the two things this service renders to.

## Resumption: not our problem

The service guarantees three things and nothing more:

1. The brief's question context and intent are durable.
2. Responses are durably retrievable by handle.
3. A signal fires when collection closes.

It never resumes an agent. That keeps lifecycle policy where it belongs and this
codebase small. Both usage patterns fall out of the same primitive:

- **Long-running session** (the happy path — Claude Code sessions here run for
  days) long-polls the handle and continues inline. Waiting is a client concern.
- **Ephemeral agent** hands the handle to a higher-level orchestrator and exits.
  This is why `intent` is a required field: responses without a record of what
  they were for leave the orchestrator with nothing to act on.

## Collection policy

A field on the brief, not an architectural choice. The service enforces whichever
was named:

- **Close when** — all invited responded / quorum of *n* / deadline / manual.
- **Visibility** — blind (respondents cannot see each other) or open (they can).
  Blind is a survey; open is a deliberation, and they produce different answers.
- **Conflict** — never resolved by the service. Disagreement between stakeholders
  is handed to the agent intact, because resolving it is a judgment call and the
  agent is the thing holding the context to make it.
- **Only a bounded answer space can conflict.** Two people writing different
  prose is what prose does. Reporting it as disagreement buries the one question
  where they genuinely diverged under every free-text box on the form, so
  `conflicts` covers choice, boolean, rating and number only. Whether the text
  differed is still recorded, just not flagged.

## Extensibility: reviewed, not accumulated

`REVISED 2026-08-20.` This section originally argued that a new widget must never
require a redeploy, so an agent could add one mid-task. That was built, shipped,
and then removed.

Two things were wrong with it. The registry was global: an agent could define a
widget every other agent then saw, and overwrite one another agent was using —
the same isolation gap as briefs, missed in the same place and found the same
way. And the argument was weaker than it looked. A shared vocabulary anyone can
extend at runtime is not shared, it is accumulated, and nobody reviews an
accumulation.

Three tiers, with the middle one now reviewed:

1. **Primitives** — compiled in. Curated and deliberately small.
2. **Widgets** — compositions of primitives, twelve of them, in
   `src/domain/builtin-widgets.ts`. A thirteenth is a pull request.
3. **Raw** — agent-authored HTML in a sandboxed iframe, for what tier 2 cannot
   express. Needing it twice is the argument for the pull request.

What this costs is the mid-task escape hatch for a genuinely novel shape, and
that cost is accepted. Tier 3 covers the case; it just does not add to anyone
else's vocabulary while doing so.

## Identity

Signed, expiring, per-participant links. The agent names the participants; the
service mints one unguessable URL each. Attribution is free — it is whichever
link was used. No accounts, no email infrastructure, and it works for external
stakeholders who have no Claude access.

The weakness is understood and accepted: a forwarded link is a forwarded
identity. This is feedback collection, not an audit trail. If responses ever need
to be contested, that is the point to add email verification — not before.

## Layering

Dependencies point inward. See `CLAUDE.md`.

    domain/        Brief, widget registry semantics, collection policy
                   evaluation, response coalescing. Pure. No I/O, no clock.
    application/   Create brief, record response, close collection, notify.
                   Orchestration only — decides nothing.
    adapters/
      http/        The agent-facing API and the participant-facing app
      store/       Postgres
      render/      Two implementations of one port:
                     - hosted HTML (shareable link, collects responses)
                     - Claude Artifact (zero deploy, private, read-only)
      notify/      Collection-closed signal

Two render targets are two adapters behind one port. If rendering ever needs to
know which target it is on, the port is wrong.

## Runtime

Containerized. One image, two orchestrators:

- **Local** — `docker compose up`, with Postgres alongside. Must be genuinely
  one command; "easy to run locally" is a stated requirement, not a nicety.
- **Cluster** — deployed to k3s via Flux, as a manifest in `chuggy-fabric`'s
  `cluster/apps/`. Public ingress through the existing Cloudflare Tunnel →
  Traefik path. Postgres already runs in the `chuggy` namespace.

The Postgres instance is shared; the database and the schema are not. Reusing the
server is a cost decision about a development cluster, and it is where the
argument stops: sirdocalot owns its database, creates its own schema, and keeps
`public` off its `search_path`, so an unqualified name cannot reach another
service's tables. What remains coupled is availability — if that instance is
down, so is this.

Same image in both, same Postgres major version in both. A local stack that
diverges from the cluster is a source of bugs that only appear after deploy.

## The per-dev cluster problem

`OPEN` — and the one risk worth naming up front.

Every dev runs their own independent single-node k3s cluster behind their own
tunnel. So a participant link points at *that dev's box*. A stakeholder clicking
it six hours later gets an answer only if that box is still up — and the box is
also a NixOS host that gets rebuilt.

For a dev-phase tool this is probably tolerable: the boxes are always-on and the
blast radius is one dev's briefs. It is not tolerable if links go to people
outside the team, because a dead link to an external stakeholder is worse than
never having sent one.

The cheap insurance, taken now: **never bake the host into a brief's identity.**
A handle and a participant token identify a brief; the hostname serving it is
deployment configuration. That costs nothing today and keeps "move it to one
shared deployment" a config change rather than a migration.

## Build order

Capture-in first — done; the vertical slice runs end to end locally. Summarize-out is well served by Claude Artifacts today, and the
component library falls out of doing capture-in properly — a form is a rendered
brief plus a response schema. The other order produces a nicer renderer and none
of the hard parts.

## Agent-facing interface

The REST API is built — see README.md for the routes. It is bearer-authenticated
and is what the participant-facing app uses too.

`OPEN` — an MCP server over the top, exposing `list_widgets`, `create_brief`,
`await_responses` as tools. That is the idiomatic agent-facing
surface and would remove the need for an agent to remember curl invocations. REST
stays underneath either way, because an orchestrator resuming a session is not
necessarily an agent.
