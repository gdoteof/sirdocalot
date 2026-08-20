# Self-hosting sirdocalot

One container and a Postgres. The same image runs on a laptop and in a cluster,
which is the point: a local stack that diverges from the deployed one is a source
of bugs that only appear after deploy.

This document covers running it locally, getting your own agent onto it, every
environment variable it reads, deploying it, putting it behind a Cloudflare
Tunnel, and four constraints that were measured rather than assumed.

## Run it locally

```
just up
```

That is `docker compose up --build --detach`: Postgres, then the service, on
**http://localhost:8080**. There is no setup step. The credentials in
`docker-compose.yml` are development values on purpose — a local stack that needs
a secrets ceremony before it runs is one people stop running. It runs detached
because the next thing you do is enrol, and holding the terminal would mean
opening a second one before you have done anything. `just logs` follows the
service log.

Migrations are applied at start-up by the process itself, so a fresh volume needs
nothing done to it. Postgres is deliberately not published on a host port: the
service reaches it over the compose network, and a published port collides with
whatever Postgres you already run. To get a shell on it:

```
docker compose exec postgres psql -U sirdocalot
```

The rest of the recipes:

```
just logs          # follow the service log
just down          # stop
just reset         # stop and drop the volume; the volume is the only state
just check         # typecheck, layering boundaries, tests -- the gates, in order
just smoke         # end to end: create a brief, answer as two people, read results
just agent-smoke   # the same, over the keypair path, with two enrolled agents
```

`just smoke` (`scripts/smoke.sh`) drives the API with the operator key and proves
the participant page renders, both answers land, the disagreement comes back
unresolved, and a late answer is refused. `just agent-smoke`
(`scripts/agent-smoke.sh`) enrols two throwaway agents and checks that the
creating agent reads back its own brief **and** that the other agent is refused.
Either half alone passes while the feature is completely broken, which is how the
bug it was written for survived the first test.

Both need a stack already running, and both default to `http://localhost:8080`
with `AGENT_KEY=dev-agent-key`.

## Enrol yourself as an agent

Registration is gated by an invite code. On the public instance that gate is a
promise to a small machine; on your own instance you are the operator, so the
gate is self-service — you hold `AGENT_KEY`, and `AGENT_KEY` mints codes.

```
just enrol
just enrol "my laptop"     # with a name you choose
```

`just enrol` runs `scripts/enrol.sh`, which does the whole bootstrap in one pass:
mints an invite code with the admin key, generates an Ed25519 keypair, registers
the **public** half, writes `~/.sirdocalot/key.pem` and `~/.sirdocalot/agent`, and
prints the `claude mcp add` line to paste. Re-running is safe — it never
overwrites an existing key, which is the only copy of a private half nothing can
reissue.

The service never receives a private key. It stores public keys, which is what
verification needs — a copy of the database lets someone verify signatures and
forge none.

To enrol somebody else, mint them a code and hand it over:

```
just invite "who this is for"
```

They set `INVITE_CODE` and run the same script against your instance rather than
minting their own, since the minting half is the part that needs your operator
key.

### The manual path

Worth reading once, so you know what the script does rather than trusting it.
`BASE` is where the service is; `AGENT_KEY` is the operator key.

Mint a code:

```
curl -sS -X POST $BASE/api/invites \
  -H "Authorization: Bearer $AGENT_KEY" \
  -H 'content-type: application/json' \
  -d '{"note":"who this is for"}'
```

That returns `{"code": "xxxx-xxxx-xxxx", "paste": "..."}`. The `paste` line is a
ready-made instruction to hand to an agent; it points at `$BASE/start`, which
serves this same walkthrough as plain text.

Make a key and register the public half:

```
mkdir -p ~/.sirdocalot && chmod 700 ~/.sirdocalot
openssl genpkey -algorithm ed25519 -out ~/.sirdocalot/key.pem
chmod 600 ~/.sirdocalot/key.pem

PUB=$(openssl pkey -in ~/.sirdocalot/key.pem -pubout -outform DER | tail -c 32 | openssl base64 -A)

curl -sS -X POST $BASE/api/agents \
  -H 'content-type: application/json' \
  -d "{\"name\":\"my-agent\",\"publicKey\":\"$PUB\",\"inviteCode\":\"xxxx-xxxx-xxxx\"}"
```

`POST /api/agents` is the only unauthenticated route, because it is where an
agent gets the identity every other route requires. Save the `agentId` it
returns:

```
echo "<the agentId from above>" > ~/.sirdocalot/agent
```

Then install the MCP client, which reads those two files and signs every request
with them:

```
curl -sS $BASE/mcp -o ~/.sirdocalot/mcp-server.mjs
claude mcp add --transport stdio sirdocalot --scope user \
  --env SIRDOCALOT_URL=$BASE \
  -- node ~/.sirdocalot/mcp-server.mjs
```

`SIRDOCALOT_URL` is not optional on a self-hosted instance. The client defaults
to `https://sirdocalot.vteng.io`, and a key registered with your instance is an
unknown key to that one. The symptom is `unauthorized` on every call, which reads
like a broken signature rather than a wrong host.

`$BASE/cli` serves a `sdl` helper that signs requests the same way from a shell,
for anything that is easier to check with curl than through a tool call.

Three things the API does that are easier to know than to discover:

- **Registering a public key twice is idempotent.** A retried bootstrap returns
  the existing agent rather than spending a second invite code.
- **A code is spent if and only if an agent exists because of it.** Claiming and
  creating are one commit, so losing a race is indistinguishable from using a
  spent code.
- **There is a hard cap of 200 agents per deployment.** It is a promise to the
  box, not a security control; the invite code is the security control.

## Configuration

Read once, at start-up, from the environment. Two variables are required, and if
either is absent the process throws before it listens, naming every one that is
missing. A missing secret is a precondition for serving this kind of work at all,
not a request that fails later in front of whichever stakeholder clicked first.

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `PORT` | no | `8080` | Port the HTTP server binds. |
| `DATABASE_URL` | **yes** | — | Postgres connection string. Migrations run against it at start-up. |
| `DATABASE_SCHEMA` | no | `sirdocalot` | The schema it creates and owns. `public` is deliberately not on the `search_path`, so an unqualified name cannot resolve into another service's tables. |
| `AGENT_KEY` | **yes** | — | The **operator** key. See below. |
| `BASE_URL` | no | `http://localhost:$PORT` | Public origin. Participant links are composed from it. Trailing slashes are stripped. |
| `LINK_TTL_HOURS` | no | `336` (14 days) | How long a participant link stays answerable. Checked in the query that resolves a token, not after it. |
| `MAX_AWAIT_MS` | no | `90000` | Ceiling on one long poll. A caller's `timeout_ms` is clamped to it. Measured, not chosen — see the constraints below. |
| `POLL_INTERVAL_MS` | no | `2000` | How often an in-flight `/await` re-checks whether collection has closed. |
| `NOTIFY_WEBHOOK` | no | unset | URL to POST when collection closes. Unset means the signal is logged instead, which is a working default rather than a disabled feature. |

`AGENT_KEY` reads like an agent credential and is not one. **It is the operator's
key**, and the distinction is the whole authorization model. As a bearer token it mints
invite codes, lists invites and agents, and disables agents — authority no agent
has. Agents authenticate with keypairs they generate themselves and never hold
this key. Generate it with `openssl rand -hex 24` and treat it as the one secret
this deployment has.

The numeric variables fall back to their default when the value does not parse as
a finite number. They do not refuse it, so a typo is silent — check the
`listening` line in the logs if a setting appears to have no effect.

## Deploy it somewhere

A container and a reachable Postgres. Nothing else.

```
docker build -t sirdocalot:0.5.0 .
```

There is no build step inside that image. `tsconfig` sets `erasableSyntaxOnly`,
so Node strips the types itself and the thing running in production is the same
text that is in the repository. The container listens on 8080, runs as a
non-root user, and needs no writable filesystem beyond a `/tmp` it does not
currently use.

What it needs from the outside:

- **A Postgres it can reach**, with a role that may create a schema in its
  database. It applies its own migrations at start-up.
- **`BASE_URL` set to the public URL.** Participant links are composed from it.
  Get this wrong and the service works perfectly while handing out links nobody
  outside can open. It is configuration and not part of a brief's identity, so
  changing it later is a config change rather than a migration.
- **A supervisor that restarts it.** The process crashes rather than retries if
  Postgres is unreachable at start-up. That is the intended shape — a process
  that masks a missing database is worse — but it means one restart is normal on
  a cold boot where both come up together.
- **Exactly one replica.** This is not a preference. See the constraints below.

`GET /healthz` queries the database and answers 503 if it cannot. Use it for
readiness. Use something cheaper for liveness: a pod that cannot reach Postgres
should leave the load balancer, not be restarted, because restarting it fixes
nothing and destroys every long poll it was holding.

Give it a generous termination grace period — the example uses 45 seconds. A long
poll can be mid-wait when the process is asked to stop, and `main.ts` drains
rather than cutting connections.

### Kubernetes, as one worked example

`deploy/sirdocalot.yaml` is the manifest the public instance runs: a Deployment
pinned to one replica with a `Recreate` strategy, a Service, and a Traefik
Ingress. `deploy/flux-source.yaml` points Flux at this repository so later changes
reconcile on their own.

It is one worked example, not the only shape. It carries assumptions that are
about that cluster and not about this service — a node selector, a
`chuggy.dev/postgres-client` label a NetworkPolicy demands, an image imported
into the node's containerd because there is no registry there yet. Read the
comments at the top before copying it; they say which parts are load-bearing and
which are local colour. Secrets are created out of band and are not in the file.

## Make it publicly reachable with a Cloudflare Tunnel

Participants need to open a link. If the service runs on a home server, a tunnel
is the realistic path: no port forwarding, no static IP, no certificate to renew.

Install `cloudflared`, then authenticate and create a named tunnel:

```
cloudflared tunnel login
cloudflared tunnel create sirdocalot
```

`create` prints a UUID and writes a credentials file named after it. Keep the
UUID. Route DNS with it:

```
cloudflared tunnel route dns <TUNNEL-UUID> sirdocalot.example.com
```

**Pass the UUID, not the tunnel name.** `cloudflared` accepts a name here and
will resolve it, and if more than one tunnel has ever carried that name it can
create the CNAME against a different one and report success. You get a green
command, a DNS record, and a hostname that answers from a tunnel nothing is
listening on. The failure has no error message attached to it, which is what
makes it expensive. The UUID is unambiguous.

Point the tunnel at the service. In `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: /root/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: sirdocalot.example.com
    service: http://localhost:8080
  - service: http_status:404
```

Run it, as a foreground process while you are checking it and as a service once
it works:

```
cloudflared tunnel run <TUNNEL-UUID>
```

Then set `BASE_URL=https://sirdocalot.example.com` and restart the service.
Verify both halves, because they fail independently:

```
curl -sS https://sirdocalot.example.com/healthz
```

and create a brief, then check that the participant link it returns carries the
public hostname rather than `localhost`.

If the service runs in a cluster behind an ingress controller, the tunnel points
at the ingress rather than at the service, and the hostname has to be named in
both places. Enumerating a hostname in two systems means it serves only when both
agree.

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

## Where to go next

`README.md` for the API surface and the widget vocabulary. `docs/DESIGN.md` for
the decisions behind both, and what is still open.
