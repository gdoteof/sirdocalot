<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/mascot-dark.png">
  <img src="assets/mascot-light.png" alt="Sir DocAlot: a knight holding a quill, a checklist shield, and a stack of documents" width="220" align="right">
</picture>

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

### What that is worth, measured

One session was forked twice and each fork given the same instruction, differing
only in how to hand the work over. A fork inherits its parent's context exactly,
so the difference between the two runs is the cost of the medium and nothing else.
Both ends of every pair published a real link. Three pairs, on Opus 5 — one of
them, in full:

| | Compose a brief | Author and publish a page |
| --- | --- | --- |
| Tokens written | 3,497 | 8,262 |
| Context added to the session | 5,138 | 17,307 |
| Tool calls | 1 | 3 |
| Turns | 4 | 7 |
| Wall clock | 61s | 161s |

Medians across the three pairs: **2.4× the output, 3.5× the context, 2.9× the
wait.** The publishing path loads a design skill, writes a file, publishes it, and
carries the whole page back through the transcript. The brief path makes one call.

Every figure above, all three pairs, and what the comparison does not claim:
[**sirdocalot.vteng.io/bench**](https://sirdocalot.vteng.io/bench).

The saving is in the path, not in the markup. Compare the two *generations* alone
— emit this as JSON, emit this as HTML — and the gap is close to nothing on a
document that is mostly prose, because both write the same words and only one also
writes the tags around them.

The runs and the harness are in [`bench/`](bench/README.md).

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

## Run it yourself

A container and a Postgres, the same image locally and in production.
[`docs/SELF-HOSTING.md`](docs/SELF-HOSTING.md) covers enrolling yourself as an
agent on your own instance, every environment variable, deploying it, putting it
behind a Cloudflare Tunnel, and the four operational constraints that were
measured rather than assumed — starting with running exactly one replica.

## Getting an agent onto it

One line, plus an invite code:

> Set yourself up on sirdocalot: read https://sirdocalot.vteng.io/start and
> follow it. My invite code is `xxxx-xxxx-xxxx`.

`/start` walks an agent through generating an Ed25519 keypair, registering the
**public** half, and saving the signing helper from `/cli`. This service never
receives a private key and holds nothing that could act as anyone — a copy of the
database lets an attacker verify signatures, which is what verification is for,
and forge none.

Registration is gated by invite code because this runs on one small box that does
not scale. Codes are rows, so one can be handed to one person, spent once, and
traced afterwards. There is also a hard cap on total agents, which is a promise to
the box rather than a security control.

Mint a code with the operator key:

```
curl -sS -X POST $BASE/api/invites -H "Authorization: Bearer $AGENT_KEY" \
  -H 'content-type: application/json' -d '{"note":"who this is for"}'
```

The response includes a ready-made `paste` line.

**An agent sees only its own briefs.** Asking after someone else's returns `not
found`, not `forbidden`, so ids cannot be probed.

## The agent API

Two ways in. `AGENT_KEY` as a bearer token is the **operator**, which mints
invite codes and disables agents — authority no agent has. Agents sign each
request with their key: `x-sdl-agent`, `x-sdl-timestamp`, `x-sdl-nonce`,
`x-sdl-signature` over method, path, timestamp and a digest of the body.
Signatures are good for five minutes and each nonce is accepted once.

| | |
|---|---|
| `GET /api/widgets` | The whole vocabulary. Read this first; it is also the only widget route. |
| `POST /api/briefs` | Create a brief. Returns a handle and one link per participant. |
| `GET /api/briefs/:id` | Status and coalesced answers. |
| `GET /api/briefs/:id/await?timeout_ms=` | Long poll until collection closes. |
| `POST /api/briefs/:id/close` | Close it now, with whatever has arrived. |
| `GET /api/briefs/:id/artifact` | Self-contained HTML, for publishing as a Claude artifact. |
| `POST /api/agents` | Register a public key with an invite code. The only unauthenticated route. |
| `POST /api/invites` | Operator only. Mint an invite code. |
| `GET /api/agents` | Operator only. Who is registered. |
| `POST /api/agents/:id/disable` | Operator only. Revoke an agent. |

Participants get `/r/:token` — a short link like `/r/tkcmc5b527gb`, a
server-rendered page with a plain form. No account, no JavaScript, no Claude
access needed.

The link used to be a signed token and 150 characters of it, which wrapped in
every mail client. The statelessness bought nothing: resolving one still loads the
brief from the same database, so the signature was paying for a round trip that
already happened. A stored token is shorter, and it *can* be revoked where a
signed one cannot — though be precise about that: `participant_links.revoked_at`
exists and the resolve query honours it, but no route sets it. Revoking a link
today is an `update` against that table. The alphabet drops `0`/`o`, `1`/`l`/`i` and `u`, because these get read
aloud and retyped.

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

Every widget, rendered from the example it ships with: **/widgets**. That page is
built from `BUILTIN_WIDGETS` through the same block renderer the real briefs use,
so it shows the thing itself rather than a description of it — and a widget that
breaks does so there, in the open.

Three tiers, and which tier a thing lives in is the whole design:

1. **Primitives** — compiled in. `heading`, `prose`, `callout`, `list`,
   `keyValue`, `table`, `code`, `divider`, `field`, `raw`. Small, and grows
   slowly, because this is the tier that costs a deploy.
2. **Widgets** — compositions of primitives, twelve of them, defined in
   `src/domain/builtin-widgets.ts`. A thirteenth is a pull request. They were
   postable at runtime once; any agent could then add a widget every other agent
   saw, and overwrite one somebody else was using. A vocabulary anyone can extend
   at runtime is not shared, it is accumulated.
3. **`raw`** — agent-authored HTML in a sandboxed iframe, for what tier 2 cannot
   express. No scripts, no same-origin, no forms.

A widget definition is a props declaration plus a layout template. The template
language is three constructs and will stay three:

| | |
|---|---|
| `{"$": "path"}` | substitute the value at `path`, whatever its type |
| `{"$each": "path", "as": "item", "body": [...]}` | repeat the body per element |
| `{"$if": "path", "then": [...], "else": [...]}` | include a branch |

Every widget is exercised by the test suite before it ships, which is the review
that used to be impossible when definitions arrived over HTTP.

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

## License

[AGPL-3.0-or-later](LICENSE).

Worth knowing what that means for a service rather than a library. Section 13
says that if you run a modified version and let other people interact with it
over a network, those people must be offered its source. The landing page links
to this repository for exactly that reason — if you fork it and deploy your
fork, change that link to point at yours.
