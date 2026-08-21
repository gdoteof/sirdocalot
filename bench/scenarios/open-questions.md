---
id: open-questions
title: The open questions in DESIGN.md
source: docs/DESIGN.md
collects: true
participants: ["Priya", "Sam"]
ask: >-
  Two maintainers need to settle these. Give them the argument as it stands, and
  collect a position from each on every open item, plus room to say why.
---

Source material, verbatim from `docs/DESIGN.md`:

## The core bet: a schema, not a framework

Generating bespoke HTML costs thousands of output tokens every time, and that
generation — not context loading, not deploy latency — is where the current
approach is slow and expensive. So the agent-facing surface is a **schema it
emits against**, not a framework it programs against:

```json
{"type": "decision-matrix", "options": [...], "criteria": [...]}
```

That is a 20–50× token reduction over an authored page, and it is the entire
reason this service exists. Any design decision that pushes agents back toward
writing markup has broken the bet.

> `OPEN` — worth confirming against two or three real past generations before
> committing. If the dominant cost turns out to be context loading rather than
> generation, the answer is a cached design doc, not this service.

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

## Agent-facing interface

The REST API is built — see README.md for the routes. It is bearer-authenticated
and is what the participant-facing app uses too.

`OPEN` — an MCP server over the top, exposing `list_widgets`, `create_brief`,
`await_responses` as tools. That is the idiomatic agent-facing
surface and would remove the need for an agent to remember curl invocations. REST
stays underneath either way, because an orchestrator resuming a session is not
necessarily an agent.
