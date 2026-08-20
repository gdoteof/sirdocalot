#!/bin/sh
# Ask the operator something through sirdocalot instead of through chat.
#
# The agent key is read from the cluster secret rather than kept anywhere, so this
# works from a fresh session with no setup beyond kubectl access.
#
#   ./scripts/ask.sh new brief.json     create a brief, print the links
#   ./scripts/ask.sh read <id>          what has come back so far
#   ./scripts/ask.sh wait <id> [secs]   hold until collection closes
set -eu

BASE="${SIRDOCALOT_URL:-https://sirdocalot.vteng.io}"
KEY="${AGENT_KEY:-$(kubectl get secret sirdocalot -n sirdocalot \
  -o go-template='{{index .data "agent-key" | base64decode}}')}"
AUTH="Authorization: Bearer $KEY"

usage() { echo "usage: $0 {new <file.json>|read <id>|wait <id> [seconds]}" >&2; exit 2; }
[ $# -ge 1 ] || usage

case "$1" in
  new)
    [ $# -eq 2 ] || usage
    curl -fsS -X POST "$BASE/api/briefs" -H "$AUTH" -H "Content-Type: application/json" \
      -d @"$2" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d:
    print("refused:", d["error"])
    print(json.dumps(d.get("details"), indent=2)[:2000])
    sys.exit(1)
print("brief:", d["id"])
for i in d["invitations"]:
    print("link: ", i["name"], "->", i["url"])
if not d["invitations"]:
    print("read-only brief; artifact at", d["artifactUrl"])
'
    ;;
  read)
    [ $# -eq 2 ] || usage
    curl -fsS -H "$AUTH" "$BASE/api/briefs/$2" | python3 -m json.tool
    ;;
  wait)
    [ $# -ge 2 ] || usage
    # Bounded by the server's own ceiling; a timed-out wait is a legitimate
    # outcome, not an error, and comes back with whatever has arrived.
    curl -fsS -H "$AUTH" "$BASE/api/briefs/$2/await?timeout_ms=$(( ${3:-300} * 1000 ))" \
      | python3 -m json.tool
    ;;
  *) usage ;;
esac
