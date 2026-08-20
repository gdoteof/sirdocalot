# sirdocalot

Just-in-time documentation and feedback widgets that AI agents use to communicate
with their operators. Agents surface docs at the moment they are needed, and
collect operator feedback through embeddable widgets rather than prose in a chat
log.

Design decisions, vocabulary, and open questions live in
[`docs/DESIGN.md`](docs/DESIGN.md) — read it before proposing architecture.

> Early stage — this file is the contract for how work happens here, not yet a
> map of the code. Expand the architecture section as the codebase lands.

## Engineering practices

This repo uses the [blessed practices](https://github.com/kasofsk/blessed-practices)
as its house style. They are installed as project-scoped plugins (see
`.claude/settings.json`), so every session in this repo has them available as
skills. **Load the relevant skill before acting** — each is a full document, and
the one-liners below are pointers, not substitutes.

| Skill | The rule |
| --- | --- |
| `push-back-and-verify-assumptions` | Treat the operator as a fellow engineer. Push back on a wrong premise, state assumptions out loud, keep asking until they are right. No operator and the request is contradictory? Stop — do not build something plausibly correct. |
| `layering` | Dependencies point inward. The domain imports no adapter, framework, I/O library, or ambient capability. Inner layers declare ports; outer layers implement them. Plain, parsed data crosses boundaries — never a foreign model. |
| `domain-modelling` | Invariants first, records second. Small aggregates, reference others by id. Value objects over primitives. Make illegal states unrepresentable; a constructor that cannot refuse is a constructor that lies. |
| `modular-and-layered-code` | Architect so a future agent can work at a single layer. Strict tested contracts between layers, test hardest at domain boundaries, keep pure logic free of I/O and confine impurity to the edges. |
| `idiomatic-by-default` | Take the ecosystem's standard path unless there is an articulable reason not to. Don't hand-roll what the ecosystem provides, and don't escalate a decision the idiom already answers. |
| `fix-the-assumption-not-the-hack` | When a feature invalidates an assumption the design rests on, rethink the pattern instead of landing a tweak. A workaround needing a long comment to justify itself is the tell. |
| `dependencies` | Add, remove, upgrade, and pin with the ecosystem's package manager. Never hand-edit `package.json`, `Cargo.toml`, `pyproject.toml`, or any other manifest. |
| `comments-describe-the-code` | Comments describe the code, never the prompt or conversation that produced it. No "as requested" or "changed per discussion". Provenance scaffolding comes down before merge. A long justifying comment means the code is wrong. |

Three of these carry extra weight for this project, because the product itself is
about agent–operator communication:

- **`push-back-and-verify-assumptions`** — we are building the channel operators
  use to correct agents. Modelling that behaviour in how we build it is the point.
- **`layering`** — widgets are adapters. Feedback semantics, doc-relevance rules,
  and trigger conditions belong in the domain, not in a React component or an
  HTTP handler.
- **`domain-modelling`** — "documentation", "trigger", "feedback", "operator",
  "session" need one agreed name each, used the same way in the core and at every
  edge. Settle the vocabulary before the schema.

## Plugin setup

The practices are declared in `.claude/settings.json` (`enabledPlugins` plus
`extraKnownMarketplaces`), so a fresh clone picks them up. To reinstall by hand:

```
/plugin marketplace add kasofsk/blessed-practices
/plugin install layering@blessed-practices     # …and the other seven
```
