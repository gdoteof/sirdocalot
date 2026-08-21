---
id: deploy-findings
title: What the first self-hosting attempt exposed
source: git commit c0acd6c
collects: false
ask: >-
  Write this up for the people who will hit the same three things. Each one is a
  symptom that pointed somewhere other than its cause.
---

Source material, verbatim from the commit that recorded these:

```
Three things self-hosting exposed

The MCP client hardcoded this deployment as its default base URL, so a
self-hoster who followed /start by hand installed a client that signed
requests to somebody else's host with a key that host had never seen. The
symptom is `unauthorized` on every call, which reads like a broken
signature rather than the wrong address. The instance now substitutes its
own URL when it serves the file, the way /cli already worked, so a client
downloaded from your deployment talks to your deployment.

A lone trailing backslash inside a template literal is a line
continuation, not a backslash, so the `claude mcp add` command on /start
arrived as one joined line with the continuation silently eaten.

An unparseable numeric environment variable fell back to its default
without saying so -- MAX_AWAIT_MS=90s quietly became 90 seconds -- in a
loader whose whole stated posture is refusing loudly. It refuses now.

Also a test that no page stylesheet redefines a class the shared one
defines. That has bitten twice, both times found by eye, which is not a
method: the gallery defined .label, which is what the block renderer calls
a field label, so every input inside a preview rendered uppercase and
tiny. The guard is proved to bite before it is trusted.

```
