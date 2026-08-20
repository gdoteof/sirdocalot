#!/bin/sh
# Enrol this machine as an agent against a sirdocalot instance.
#
# On a hosted instance somebody hands you an invite code. On your own instance
# you are the operator, so the gate is self-service: this mints a code with the
# admin key and immediately spends it.
#
#   ./scripts/enrol.sh                 against http://localhost:8080
#   ./scripts/enrol.sh "my laptop"     with a name you choose
#
#   SIRDOCALOT_URL   instance to join      (default http://localhost:8080)
#   AGENT_KEY        the operator key      (default dev-agent-key, the compose value)
#   SIRDOCALOT_HOME  where creds are kept  (default ~/.sirdocalot)
set -eu

BASE="${SIRDOCALOT_URL:-http://localhost:8080}"
ADMIN="${AGENT_KEY:-dev-agent-key}"
DIR="${SIRDOCALOT_HOME:-$HOME/.sirdocalot}"
# ${1:-...} does not fire on an empty string, only an unset one -- and `just
# enrol` always passes an argument, empty when none was given.
NAME="${1:-}"
[ -n "$NAME" ] || NAME="$(id -un)@$(hostname -s 2>/dev/null || hostname)"

die() { echo "error: $*" >&2; exit 1; }

command -v openssl >/dev/null || die "openssl is required"
command -v curl >/dev/null || die "curl is required"
command -v python3 >/dev/null || die "python3 is required"

curl -fsS -o /dev/null "$BASE/healthz" 2>/dev/null \
  || die "cannot reach $BASE — is it running? try: just up"

mkdir -p "$DIR" && chmod 700 "$DIR"

# An existing key is never overwritten. It is the only copy: this service holds
# the public half and cannot reissue the private one, so clobbering it would
# orphan the agent it belongs to.
if [ -f "$DIR/key.pem" ]; then
  echo "reusing the key already at $DIR/key.pem"
else
  openssl genpkey -algorithm ed25519 -out "$DIR/key.pem" 2>/dev/null
  chmod 600 "$DIR/key.pem"
  echo "generated a new key at $DIR/key.pem"
fi
PUB=$(openssl pkey -in "$DIR/key.pem" -pubout -outform DER | tail -c 32 | openssl base64 -A)

# Registration is idempotent by public key and returns the existing id without
# spending a code, so a re-run is safe. The code is only minted when there is no
# id on disk, so re-running does not quietly burn one either.
if [ -f "$DIR/agent" ] && [ -s "$DIR/agent" ]; then
  echo "already enrolled as $(cat "$DIR/agent")"
else
  CODE="${INVITE_CODE:-}"
  if [ -z "$CODE" ]; then
    CODE=$(curl -fsS -X POST "$BASE/api/invites" \
      -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
      -d '{"note":"enrol.sh"}' 2>/dev/null \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])' 2>/dev/null) \
      || die "could not mint an invite code. On someone else's instance set INVITE_CODE=<code>; on your own set AGENT_KEY to the operator key."
    echo "minted invite code $CODE"
  fi

  curl -fsS -X POST "$BASE/api/agents" -H 'content-type: application/json' \
    -d "$(python3 -c '
import json, sys
print(json.dumps({"name": sys.argv[1], "publicKey": sys.argv[2], "inviteCode": sys.argv[3]}))
' "$NAME" "$PUB" "$CODE")" \
    | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "agentId" not in d:
    print("registration refused:", d.get("error"), d.get("details"), file=sys.stderr)
    sys.exit(1)
print(d["agentId"])
' > "$DIR/agent" || die "registration failed"
  echo "registered as $(cat "$DIR/agent")"
fi

curl -fsS "$BASE/mcp" -o "$DIR/mcp-server.mjs" || die "could not fetch the MCP client from $BASE/mcp"
curl -fsS "$BASE/cli" -o "$DIR/sdl" && chmod +x "$DIR/sdl"
echo "saved the MCP client and the curl helper into $DIR"

echo
echo "Add it to Claude Code:"
echo
echo "  claude mcp add --transport stdio sirdocalot --scope user \\"
echo "    --env SIRDOCALOT_URL=$BASE \\"
echo "    -- node $DIR/mcp-server.mjs"
echo
echo "Then start a new session and ask it to list_widgets."
