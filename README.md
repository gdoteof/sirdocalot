# sirdocalot

A service agents use to hand structured documents to their operators, and to
collect the answers that come back.

Two directions, one mechanism:

- **Summarize out** — turn a wall of text into something legible.
- **Capture in** — ask one person, or several, a structured question, collect the
  answers, and make them retrievable by handle.

They are not two products. A brief collects if its widgets declare input fields;
otherwise it does not. Same registry, same renderer, same storage.

## The bet

Agents are slow and expensive at this today because they author bespoke HTML every
time. So the surface here is **a schema an agent emits**, not a framework it
programs against:

```json
{ "widget": "decision-matrix", "props": { "title": "…", "columns": [...], "rows": [...] } }
```

Anything that pushes agents back toward writing markup has broken the bet. There
is an escape hatch — a sandboxed `raw` block — and it is deliberately the last
resort, not the fast path.

## Running it

```
just up        # Postgres and the service, one command
just smoke     # end to end: create a brief, answer as two people, read results
just check     # typecheck, layering boundaries, tests
just down      # stop
just reset     # stop and wipe the database
```

`just up` needs nothing configured. The credentials in `docker-compose.yml` are
development values on purpose: a local stack that needs a secrets ceremony before
it runs is one people stop running.

## The agent API

Bearer-authenticated with `AGENT_KEY`. All JSON.

| | |
|---|---|
| `GET /api/widgets` | What can be emitted without inventing anything. Read this first. |
| `POST /api/widgets` | Define a new widget. No deploy required. |
| `POST /api/briefs` | Create a brief. Returns a handle and one link per participant. |
| `GET /api/briefs/:id` | Status and coalesced answers. |
| `GET /api/briefs/:id/await?timeout_ms=` | Long poll until collection closes. |
| `POST /api/briefs/:id/close` | Close it now, with whatever has arrived. |
| `GET /api/briefs/:id/artifact` | Self-contained HTML, for publishing as a Claude artifact. |

Participants get `/r/:token` — a server-rendered page with a plain form. No
account, no JavaScript, no Claude access needed.

### Waiting, and not waiting

The service never resumes an agent. It guarantees three things and no more: the
question context is durable, the answers are retrievable by handle, and a signal
fires when collection closes. Both usage patterns fall out of that:

- A **long-running session** calls `/await` and continues inline. Waiting is a
  client concern.
- An **ephemeral agent** hands the handle to an orchestrator and exits. This is
  why `intent.purpose` is required — answers arriving with no record of what they
  were for leave whoever picks them up with nothing to act on.

### Collection policy

Stated per brief, enforced by the service, never invented by it.

- **`closeWhen`** — `all`, `quorum` (n), `deadline` (timestamp), or `manual`.
- **`visibility`** — `blind` is a survey, `open` is a deliberation. They produce
  different answers.
- **Conflicts are surfaced, never resolved.** If two stakeholders disagree, both
  answers come back and the field is named in `conflicts`. Choosing between them
  is a judgment call and the agent is the thing holding the context to make it.
  Two people writing different free text is not a conflict — only fields with a
  bounded answer space can contest.

## Widgets

Three tiers, and which tier a thing lives in is the whole design:

1. **Primitives** — compiled in. `heading`, `prose`, `callout`, `list`,
   `keyValue`, `table`, `code`, `divider`, `field`, `raw`. Small, and grows
   slowly, because this is the tier that costs a deploy.
2. **Widgets** — compositions of primitives stored as rows. Twelve ship with the
   service. An agent that needs a thirteenth `POST`s one and uses it in the same
   turn.
3. **`raw`** — agent-authored HTML in a sandboxed iframe, for what tier 2 cannot
   express. No scripts, no same-origin, no forms.

A widget definition is a props declaration plus a layout template. The template
language is three constructs and will stay three:

| | |
|---|---|
| `{"$": "path"}` | substitute the value at `path`, whatever its type |
| `{"$each": "path", "as": "item", "body": [...]}` | repeat the body per element |
| `{"$if": "path", "then": [...], "else": [...]}` | include a branch |

Defining a widget requires an `example` that renders. A definition nobody has
expanded is a definition nobody has shown to work, and the first agent to reach
for it finds out mid-task.

## Layout

    src/domain/       Pure. No clock, no randomness, no I/O, no packages.
    src/application/  Orchestration and the ports it declares. Decides nothing.
    src/adapters/     postgres, http, render, tokens, notify
    src/main.ts       The composition root — the only module that knows every
                      implementation exists.
    deploy/           Cluster manifests. App config lives with the app.

`just boundaries` enforces the dependency direction over the module graph, not
per file — a domain helper that reaches the filesystem breaks the rule even when
every individual import looks clean. The rules are in `.dependency-cruiser.cjs`.

## Deploying

Live at **https://sirdocalot.vteng.io**, on the gtr k3s cluster, reconciled by
Flux from `chuggy-fabric`. Same image locally and in the cluster.

To ship a change:

```
just cluster-image           # build and import into the k3s node's containerd
```

then bump the tag in `deploy/sirdocalot.yaml`, copy it to chuggy-fabric's
`cluster/apps/`, and push. There is no registry in that cluster yet, so the image
is carried over SSH by hand — the first thing to replace when a second node or a
second developer needs it.

### What the deployment depends on

- **Its own database and schema on the shared server.** sirdocalot owns the
  `sirdocalot` database, creates its own schema inside it, and does not carry
  `public` on its `search_path` — an unqualified name cannot resolve into
  anything of chuggy's. The role and database are created out of band; the
  commands are at the top of `deploy/sirdocalot.yaml`. Availability is the one
  coupling that remains.
- **The pod label `chuggy.dev/postgres-client: "true"` is load-bearing.**
  Postgres sits behind a NetworkPolicy that admits only labelled pods, from
  namespaces it names. Drop the label and the pod starts, cannot connect, and
  never goes ready.
- **The hostname is enumerated in three places** — `chuggy.tunnel.hostnames` (a
  NixOS rebuild), a Cloudflare DNS route against the tunnel *UUID*, and the
  Ingress here. All three, or it does not serve.

### Known rough edge

The service crashes rather than retries if Postgres is unreachable at start-up,
and relies on Kubernetes to restart it. That is the right shape — a process that
masks a missing database is worse — but it means one restart is normal on a
cold boot where both come up together.

### One known risk

Every dev runs their own single-node cluster behind their own tunnel, so a
participant link points at that dev's box — which is also a NixOS host that gets
rebuilt. A stakeholder clicking six hours later needs it up.

The insurance is already taken: **the host is never part of a brief's identity.**
A handle plus a participant token identifies a brief; the hostname serving it is
configuration. Moving to one shared deployment is a config change, not a
migration.

## Design

`docs/DESIGN.md` — decisions, vocabulary, and what is still open.
`CLAUDE.md` — the engineering practices this repo is built to.
