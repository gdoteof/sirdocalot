# Thin wrappers. Every recipe here is one command someone would otherwise have to
# remember; nothing here holds logic of its own.
#
# `just --list` shows the last comment line above a recipe as its description, so
# each block below ends on a line that reads well on its own.

# Typecheck, boundaries and tests, in order.
check: typecheck boundaries test

typecheck:
    npx tsc -p .

# The layering rule from CLAUDE.md, checked over the module graph.
boundaries:
    npx depcruise src --config .dependency-cruiser.cjs

test:
    node --test --experimental-strip-types "test/**/*.test.ts"

# Postgres and the service, on http://localhost:8080. Needs nothing configured.
#
# Detached, because the documented first run is "just up" then "just enrol" and
# holding the terminal would mean a second one before you have done anything.
up:
    docker compose up --build --detach
    @echo "http://localhost:8080 — next: just enrol"

# Follow the service log.
logs:
    docker compose logs --follow sirdocalot

down:
    docker compose down

# Stop, and wipe the database volume. The volume is the only state.
reset:
    docker compose down -v

fmt:
    npx prettier --write .

# Enrol this machine as an agent and print the `claude mcp add` line.
#
# On your own instance you are the operator, so this mints its own invite code
# and spends it. Re-running is safe: it never overwrites an existing key.
#
#     just enrol
#     just enrol "my laptop"
#
# Self-service enrolment against a running instance.
enrol name="":
    ./scripts/enrol.sh "{{name}}"

# Mint an invite code to hand to somebody else.
invite note="":
    #!/bin/sh
    curl -fsS -X POST "${SIRDOCALOT_URL:-http://localhost:8080}/api/invites" \
      -H "Authorization: Bearer ${AGENT_KEY:-dev-agent-key}" \
      -H 'content-type: application/json' \
      -d "$(NOTE="{{note}}" python3 -c 'import json,os; print(json.dumps({"note": os.environ["NOTE"]}))')" \
      | python3 -m json.tool

# End to end: create a brief, answer as both participants, read the result back.
smoke:
    ./scripts/smoke.sh

# End to end on the keypair path: two agents, ownership and isolation both checked.
agent-smoke:
    ./scripts/agent-smoke.sh

# Build the image and load it into a k3s node's containerd.
#
# There is no registry in the cluster this was built for, so the image is carried
# there by hand. Replace this the moment a second node needs the same image. The
# host has no default on purpose: this repo is public, and a default pointing at
# one particular machine is wrong for everybody else.
#
# Build and ship the image to a k3s node over SSH.
cluster-image host tag="latest":
    docker build -t sirdocalot:{{tag}} .
    docker save sirdocalot:{{tag}} | ssh {{host}} 'sudo k3s ctr images import -'
