#!/bin/sh
# End-to-end against a running local stack. Creates a brief that two people must
# answer, answers it as both, and reads back the coalesced result -- including the
# disagreement, which is the part the service must not resolve on its own.
set -eu

BASE="${BASE_URL:-http://localhost:8080}"
KEY="${AGENT_KEY:-dev-agent-key}"
AUTH="Authorization: Bearer $KEY"

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "1. widgets the agent can use without inventing anything"
curl -fsS -H "$AUTH" "$BASE/api/widgets" | python3 -c '
import json, sys
for w in json.load(sys.stdin)["widgets"]:
    print("   %-16s %s" % (w["name"], w["summary"][:62]))
'

say "2. create a collecting brief from the schema alone"
CREATED=$(curl -fsS -X POST "$BASE/api/briefs" -H "$AUTH" -H "Content-Type: application/json" -d @- <<'JSON'
{
  "title": "Ship the payments migration this Friday?",
  "intent": {
    "purpose": "Decide whether to cut over on Friday or wait a week",
    "resumeHint": "session-abc123"
  },
  "participants": [
    { "name": "Alex Rivera", "role": "Eng lead" },
    { "name": "Sam Okonkwo", "role": "Ops" }
  ],
  "policy": { "closeWhen": { "kind": "all" }, "visibility": "blind" },
  "blocks": [
    { "widget": "summary", "props": {
        "title": "Where the migration stands",
        "lead": "Dual writes have been on for nine days with no drift. The backfill finished Tuesday.",
        "points": [
          "Reconciliation is clean across all 14 shards",
          "Rollback path is tested",
          "Friday is a US holiday weekend"
        ] } },
    { "widget": "decision-matrix", "props": {
        "title": "The two options",
        "columns": ["Option", "Risk", "Cost of delay"],
        "rows": [
          ["Cut over Friday", "Low traffic, thin on-call", "None"],
          ["Wait a week", "Another week of dual writes", "~$4k infra"]
        ],
        "recommendation": "Friday, if Ops is comfortable being thin on-call." } },
    { "widget": "approval", "props": {
        "title": "Your call",
        "proposal": "Cut over on Friday evening.",
        "detail": "Answer independently. This brief is blind: you cannot see the other response." } }
  ]
}
JSON
)

printf %s "$CREATED" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("   brief:      " + d["id"])
print("   collecting: " + str(d["collecting"]))
print("   artifact:   on demand at " + d["artifactUrl"] + " (not inlined: this brief collects)")
for i in d["invitations"]:
    print("   link:       %-14s %s" % (i["name"], i["url"]))
'

pick() { printf %s "$CREATED" | python3 -c "import json,sys; print($1)"; }
ID=$(pick 'json.load(sys.stdin)["id"]')
U1=$(pick 'json.load(sys.stdin)["invitations"][0]["url"]')
U2=$(pick 'json.load(sys.stdin)["invitations"][1]["url"]')

say "3. the participant page renders for a real browser"
printf '   %s bytes, HTTP %s\n' \
  "$(curl -fsS "$U1" | wc -c)" \
  "$(curl -fsS -o /dev/null -w '%{http_code}' "$U1")"

say "4. answer as both participants, deliberately disagreeing"
curl -fsS -o /dev/null -X POST "$U1" \
  --data-urlencode "decision=approve" \
  --data-urlencode "reasoning=Reconciliation is clean and rollback is tested."
echo "   Alex answered"
curl -fsS -o /dev/null -X POST "$U2" \
  --data-urlencode "decision=needs-changes" \
  --data-urlencode "reasoning=Not with one person on call over a holiday weekend."
echo "   Sam answered"

say "5. what the agent reads back"
curl -fsS -H "$AUTH" "$BASE/api/briefs/$ID" | python3 -m json.tool

say "6. a further answer is refused now collection has closed"
printf '   HTTP %s\n' \
  "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$U1" --data-urlencode 'decision=reject')"

say "smoke passed"
