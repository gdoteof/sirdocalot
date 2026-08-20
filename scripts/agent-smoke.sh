#!/bin/sh
# The keypair path, end to end, against a running stack.
#
# It exists because of a bug this would have caught: briefs were created with an
# owner that was never written to the column, so every agent got a 404 reading
# back the brief it had just made. The isolation test passed anyway -- agent two
# could not read agent one's brief, because nobody could read anything.
#
# So the check that matters here is not "the other agent is refused". It is
# "the creating agent is served AND the other agent is refused". Either half
# alone passes while the feature is completely broken.
set -eu

BASE="${SIRDOCALOT_URL:-http://localhost:8080}"
ADMIN="${AGENT_KEY:-dev-agent-key}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

enrol() {
  mkdir -p "$WORK/$1"
  openssl genpkey -algorithm ed25519 -out "$WORK/$1/key.pem" 2>/dev/null
  pub=$(openssl pkey -in "$WORK/$1/key.pem" -pubout -outform DER | tail -c 32 | openssl base64 -A)
  code=$(curl -fsS -X POST "$BASE/api/invites" -H "Authorization: Bearer $ADMIN" \
    -H 'content-type: application/json' -d '{"note":"agent-smoke"}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["code"])')
  curl -fsS -X POST "$BASE/api/agents" -H 'content-type: application/json' \
    -d "{\"name\":\"$1\",\"publicKey\":\"$pub\",\"inviteCode\":\"$code\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["agentId"])' > "$WORK/$1/agent"
}

curl -fsS "$BASE/cli" -o "$WORK/sdl" && chmod +x "$WORK/sdl"
sdl() { home=$1; shift; SIRDOCALOT_HOME="$WORK/$home" SIRDOCALOT_URL="$BASE" "$WORK/sdl" "$@"; }

enrol one
enrol two
echo "enrolled: one=$(cat "$WORK/one/agent") two=$(cat "$WORK/two/agent")"

cat > "$WORK/brief.json" <<'JSON'
{ "title": "agent-smoke", "intent": { "purpose": "regression: an agent must read back its own brief" },
  "participants": [{ "name": "Someone" }],
  "policy": { "closeWhen": { "kind": "manual" }, "visibility": "blind" },
  "blocks": [ { "widget": "ask", "props": { "title": "Q",
    "field": { "kind": "text", "id": "a", "label": "A", "required": false } } } ] }
JSON

id=$(sdl one POST /api/briefs "$WORK/brief.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
[ -n "$id" ] || fail "agent one could not create a brief"
echo "created: $id"

sdl one GET "/api/briefs/$id" | grep -q '"title"' || fail "agent one cannot read back its OWN brief (agent_id not persisted?)"
echo "ok: the creating agent reads its own brief"

sdl two GET "/api/briefs/$id" | grep -q '"error"' || fail "agent two can read agent one's brief — briefs are not scoped"
echo "ok: a different agent is refused"

sdl two GET /api/widgets | grep -q '"widgets"' || fail "agent two is not authenticated at all — the refusal above proved nothing"
echo "ok: agent two is genuinely authenticated, so that refusal was about ownership"

sdl two GET /api/agents | grep -q '"forbidden"' || fail "an agent reached an operator-only route"
echo "ok: admin routes refuse agents"

echo "agent smoke passed"
