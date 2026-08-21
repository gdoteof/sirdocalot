---
id: constraints
title: Operational constraints for anyone self-hosting
source: docs/SELF-HOSTING.md
collects: false
ask: >-
  Someone is about to make this load-bearing for their team. Turn the material
  below into something they will read before they deploy rather than after.
---

Source material, verbatim from `docs/SELF-HOSTING.md`:

## Constraints that are measured, not theoretical

Four things worth knowing before this is load-bearing for anyone but you. Each of
them was found rather than anticipated.

### Run exactly one replica

The replay-protection nonce store is in memory
(`src/adapters/crypto/nonces.ts`). Every signed request carries a nonce that is
accepted once, which is what stops a captured request being replayed inside its
five-minute freshness window.

With two replicas a nonce burned on one is unknown to the other, and a replayed
request routed to the second one succeeds. Replay protection does not degrade
under horizontal scaling; it stops working.

So the Deployment pins `replicas: 1` with a `Recreate` strategy, and that is the
single most important operational constraint here. Scaling out is possible — it
means moving the nonce store to Postgres or Redis first. The moment `replicas`
changes, that is the thing that has to change with it.

### Long polls die at about 100 seconds behind Cloudflare

Cloudflare gives an origin roughly 100 seconds to respond before it answers 524
itself. Measured through the tunnel: a 150-second poll died at 125 seconds with
HTTP 524 and no body. Not a slow response — no response, and no way for the
caller to tell a dead wait from an empty one.

Holding a connection past that ceiling does not make the caller wait longer, it
makes the wait fail. `MAX_AWAIT_MS` therefore defaults to 90 seconds: every poll
returns inside the window, and one that ran out its budget comes back with
`timedOut: true` and whatever has arrived so far. A timeout is a legitimate
outcome, not an error. The MCP client loops shorter polls so a caller asking for
five minutes gets five minutes.

Behind a different proxy, find its own timeout and set `MAX_AWAIT_MS` below it.
Whatever sits in front of this service decides the real ceiling; the service only
decides whether it respects it.

### A CDN may cache by file extension regardless of what you send

`/mcp.js` was served with `cache-control: no-store` and came back from the edge
with `cf-cache-status: HIT` and an injected `max-age=14400`. Cloudflare caches
`.js` by default, by extension, whatever the origin intended. For four hours
after every deploy, agents installed the previous client.

The fix is in the path, not in the headers: the canonical URL for the MCP client
is **`/mcp`**, with no extension. `/mcp.js` remains as an alias for anyone who
saved the old URL.

If you put any CDN in front of this, check what it caches. Origin headers are a
request, not an instruction, and the failure here is silent — everything works,
one deploy behind.

### Participant links are capabilities

Anyone holding a participant link can answer as that participant. A forwarded
link is a forwarded identity.

This is deliberate and it is the reason the product works at all: participants
need no account, no email verification, and no Claude access. Attribution is
whichever link was used, which costs nothing and is honest about what it is.

It is not an audit trail. Do not deploy this expecting one. If responses ever
need to be contested, that is the point to add verified identity — and that is a
change to this service, not a configuration option waiting to be switched on.

What you do control is the window: `LINK_TTL_HOURS` bounds how long a link stays
answerable, and expiry is checked in the query that resolves a token rather than
after it. The schema also carries `revoked_at` and honours it on every resolve,
but nothing exposes revocation over HTTP yet, so killing one link today is an
`update` against `participant_links`.
