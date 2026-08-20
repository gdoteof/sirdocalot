// How an agent gets from nothing to a working key.
//
// Served as plain text, unauthenticated, because the audience is an agent that
// was handed one line and a code. Nothing here executes anything: /cli hands back
// a script to read and save, not a pipe into a shell. An agent that will run
// whatever a URL returns is a supply chain with one link.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";

export function onboarding(baseUrl: string): Hono {
  const app = new Hono();

  // Read once, at construction. If the file is absent the image is broken, and
  // that is a missing precondition for serving this kind of work at all -- so it
  // fails at start-up rather than as a 500 discovered by whoever tried to install.
  const mcpServer = readFileSync(join(import.meta.dirname, "../../../client/mcp-server.mjs"), "utf8");
  // no-store, and it is load-bearing rather than tidy. Cloudflare caches by file
  // extension at the edge whatever the origin intended: /mcp.js came back
  // `cf-cache-status: HIT` with an injected `max-age=14400`, so for four hours
  // after a deploy every agent installing the client got the previous one.
  const text = (body: string) =>
    new Response(body, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });

  app.get("/start", (c) => {
    void c;
    return text(START.replaceAll("__BASE__", baseUrl));
  });

  app.get("/cli", (c) => {
    void c;
    return text(CLI.replaceAll("__BASE__", baseUrl));
  });

  // Served as text, like /cli, for the same reason: an agent that will run
  // whatever a URL returns is a supply chain with one link in it.
  //
  // The canonical path has no extension, because that is what decides whether
  // Cloudflare caches it. `.js` is on the list it caches by default, and a cached
  // client is one that is silently a deploy behind. /mcp.js stays as an alias for
  // anyone who saved the old URL -- no-store keeps it honest from here.
  const serveMcp = (c: unknown) => {
    void c;
    return text(mcpServer);
  };
  app.get("/mcp", serveMcp);
  app.get("/mcp.js", serveMcp);

  return app;
}

const START = `sirdocalot — setup
==================

Structured briefs you hand to your operator, and the answers back. You ask a
question as a schema; a person answers it on a web page; you read the result.

You need an invite code. This runs on one small machine, so registration is
gated. If you do not have one, ask whoever pointed you here.

Authentication is a keypair you generate. This service receives a public key and
never a private one, so there is no shared secret to leak and nothing here to
reissue if you lose yours.

1. Make a key
-------------

    mkdir -p ~/.sirdocalot && chmod 700 ~/.sirdocalot
    openssl genpkey -algorithm ed25519 -out ~/.sirdocalot/key.pem
    chmod 600 ~/.sirdocalot/key.pem

2. Register
-----------

    PUB=$(openssl pkey -in ~/.sirdocalot/key.pem -pubout -outform DER | tail -c 32 | openssl base64 -A)

    curl -sS -X POST __BASE__/api/agents \\
      -H 'content-type: application/json' \\
      -d "{\\"name\\":\\"YOUR NAME HERE\\",\\"publicKey\\":\\"$PUB\\",\\"inviteCode\\":\\"YOUR CODE HERE\\"}"

Save the agentId it returns:

    echo "AGENT_ID_FROM_ABOVE" > ~/.sirdocalot/agent

3. Wire it into your tools
--------------------------

The MCP server is the shortest path -- your model calls tools rather than
remembering curl invocations. Read it first; it is one file with no
dependencies and you should not run code you have not looked at:

    curl -sS __BASE__/mcp -o ~/.sirdocalot/mcp-server.mjs
    claude mcp add --transport stdio sirdocalot --scope user \
      -- node ~/.sirdocalot/mcp-server.mjs

It reads the key and agent id you just saved, and signs every request with
them. Nothing else to configure.

Then start a new session and you have: list_widgets, create_brief,
await_responses, read_responses, close_brief and get_artifact.

4. Or drive it with curl
------------------------

If you would rather not use MCP, every request can be signed by hand. This
helper does it for you:

    curl -sS __BASE__/cli -o ~/.sirdocalot/sdl && chmod +x ~/.sirdocalot/sdl

5. Check it works
-----------------

    ~/.sirdocalot/sdl GET /api/widgets

That lists what you can build a brief from without inventing anything. Read it
before writing a brief; most of what you want is already there.

Asking something
----------------

    ~/.sirdocalot/sdl POST /api/briefs brief.json

Returns one link per participant. Send the links, then either wait:

    ~/.sirdocalot/sdl GET /api/briefs/<id>/await?timeout_ms=300000

or exit and let whatever orchestrates you pick the answers up later by id. Both
work; the service never resumes you, it just holds the answers.

A minimal brief.json:

    {
      "title": "Which database for the new service?",
      "intent": { "purpose": "Pick a datastore before I start building" },
      "participants": [{ "name": "Sam" }],
      "policy": { "closeWhen": { "kind": "all" }, "visibility": "blind" },
      "blocks": [
        { "widget": "summary", "props": {
            "title": "Context",
            "lead": "Two options, and I do not have enough context to choose.",
            "points": ["Postgres: we run it already", "SQLite: simpler, single node only"] } },
        { "widget": "pick-one", "props": {
            "title": "Your call",
            "question": "Which one?",
            "options": [
              { "value": "postgres", "label": "Postgres" },
              { "value": "sqlite", "label": "SQLite" } ] } }
      ]
    }

Things worth knowing
--------------------

* The widget library is fixed. list_widgets is the whole vocabulary, and there
  is no way to add to it from here — a new widget is a pull request against the
  service. If none of them fit, a "raw" block renders your own HTML in a
  sandboxed frame; needing that twice is the argument for the pull request.
* Disagreement is reported, never resolved. If two people answer differently you
  get both, and the field is named in "conflicts". Deciding is your job.
* intent.purpose is required. Answers that arrive with no record of what they
  were for are useless to whoever picks them up after you are gone.
* You only ever see your own briefs.
`;

const CLI = `#!/bin/sh
# sirdocalot request signer.
#
#   sdl GET  /api/widgets
#   sdl POST /api/briefs brief.json
#   sdl POST /api/briefs @-        (body on stdin)
#
# Signs method, path, timestamp and a digest of the body with your Ed25519 key.
# The private key never leaves this machine.
set -eu

BASE="\${SIRDOCALOT_URL:-__BASE__}"
DIR="\${SIRDOCALOT_HOME:-$HOME/.sirdocalot}"
KEY="$DIR/key.pem"

[ -f "$KEY" ] || { echo "no key at $KEY — see $BASE/start" >&2; exit 1; }
[ -f "$DIR/agent" ] || { echo "no agent id at $DIR/agent — see $BASE/start" >&2; exit 1; }
AGENT=$(cat "$DIR/agent")

[ $# -ge 2 ] || { echo "usage: sdl <METHOD> <path> [file|@-]" >&2; exit 2; }
METHOD=$1
PATH_Q=$2
BODY=""
if [ $# -ge 3 ]; then
  if [ "$3" = "@-" ]; then BODY=$(cat); else BODY=$(cat "$3"); fi
fi

TS=$(date +%s)
NONCE=$(openssl rand -hex 12)
DIGEST=$(printf %s "$BODY" | openssl dgst -sha256 | sed 's/.*= *//')

# Exactly the four lines the server rebuilds, with no trailing newline.
#
# Written to a file rather than piped: Ed25519 signs the whole message at once,
# and \`openssl pkeyutl -rawin\` refuses a pipe it cannot measure -- "unable to
# determine file size for oneshot operation".
MSG=$(mktemp)
trap 'rm -f "$MSG"' EXIT
printf '%s\\n%s\\n%s\\n%s' "$METHOD" "$PATH_Q" "$TS" "$DIGEST" > "$MSG"
SIG=$(openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$MSG" | openssl base64 -A)

if [ -n "$BODY" ]; then
  printf %s "$BODY" | curl -sS -X "$METHOD" "$BASE$PATH_Q" \\
    -H "content-type: application/json" \\
    -H "x-sdl-agent: $AGENT" \\
    -H "x-sdl-timestamp: $TS" \\
    -H "x-sdl-nonce: $NONCE" \\
    -H "x-sdl-signature: $SIG" \\
    --data-binary @-
else
  curl -sS -X "$METHOD" "$BASE$PATH_Q" \\
    -H "x-sdl-agent: $AGENT" \\
    -H "x-sdl-timestamp: $TS" \\
    -H "x-sdl-nonce: $NONCE" \\
    -H "x-sdl-signature: $SIG"
fi
`;
