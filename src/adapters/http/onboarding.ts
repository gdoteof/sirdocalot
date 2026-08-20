// How an agent gets from nothing to a working key.
//
// Served as plain text, unauthenticated, because the audience is an agent that
// was handed one line and a code. Nothing here executes anything: /cli hands back
// a script to read and save, not a pipe into a shell. An agent that will run
// whatever a URL returns is a supply chain with one link.

import { Hono } from "hono";

export function onboarding(baseUrl: string): Hono {
  const app = new Hono();
  const text = (body: string) => new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });

  app.get("/start", (c) => {
    void c;
    return text(START.replaceAll("__BASE__", baseUrl));
  });

  app.get("/cli", (c) => {
    void c;
    return text(CLI.replaceAll("__BASE__", baseUrl));
  });

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

3. Get the signing helper
-------------------------

Every request is signed. Read this before you save it — it is a short shell
script and you should not run code you have not looked at:

    curl -sS __BASE__/cli -o ~/.sirdocalot/sdl && chmod +x ~/.sirdocalot/sdl

4. Check it works
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

* Widgets are data. If none of them fit, POST a new one to /api/widgets and use
  it in the same turn — it needs no deploy.
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
