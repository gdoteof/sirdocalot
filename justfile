# Thin wrappers. Every recipe here is one command someone would otherwise have to
# remember; nothing here holds logic of its own.

# Typecheck, boundaries, tests -- the gates, in order.
check: typecheck boundaries test

typecheck:
    npx tsc -p .

# The layering rule from CLAUDE.md, checked over the module graph.
boundaries:
    npx depcruise src --config .dependency-cruiser.cjs

test:
    node --test --experimental-strip-types "test/**/*.test.ts"

# The local stack: Postgres and the service, one command.
up:
    docker compose up --build

down:
    docker compose down

# Wipe the local database. The volume is the only state; dropping it is the whole
# reset.
reset:
    docker compose down -v

fmt:
    npx prettier --write .

# End-to-end against a running local stack: creates a brief, answers it as both
# participants, and reads the coalesced result back.
smoke:
    ./scripts/smoke.sh

# Build the image and load it into the k3s node's containerd.
#
# There is no registry in the fabric cluster yet, so the image is carried there
# by hand. This is the step to replace with a real registry the moment a second
# node or a second developer needs the same image.
cluster-image host="192.168.0.114" tag="0.1.0":
    docker build -t sirdocalot:{{tag}} .
    docker save sirdocalot:{{tag}} | ssh geoff@{{host}} 'sudo k3s ctr images import -'
