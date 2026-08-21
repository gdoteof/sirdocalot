# bench

What it costs an agent to hand its work to a person, measured two ways.

`docs/DESIGN.md` marked the size of that saving `OPEN`. These two experiments
closed it, and between them they found that the saving is not where it was
expected to be: barely in the generation, substantially in the path.

## The one that matters: a session forked

An agent does not generate documents from a cold prompt. It finishes a piece of
work and then has to hand it over, out of a session that already holds the work.
So: one session does real work, is **forked twice**, and each fork gets the same
instruction differing only in the medium.

A fork inherits its parent's context exactly, so both runs start from the same
bytes and the difference between them is the cost of the medium. Both ends of
every pair publish a real link — an experiment that stopped short of publishing
would not have been one, because publishing is most of what the page path costs.

Results are in `results/forks/`, and `/bench` serves them. Token counts are read
out of the forks' own transcripts, which record usage per message:

    node bench/fork-usage.mjs brief=<transcript.jsonl> artifact=<transcript.jsonl>

This one is not a `just` recipe. It needs an interactive session with both an
Artifact tool and a sirdocalot MCP server, and a subprocess has neither.

## The narrower one: cold generation

    just bench                       # 18 generations, then rewrite the report
    just bench 1                     # one run per cell, for a quick look

Two arms over the same source material, taken out of this repository rather than
written for the benchmark: emit a self-contained HTML document, or emit the JSON
arguments for `create_brief`. Both arms get the same system prompt, the same
instruction and the same source; the prompts differ in one paragraph, the one
naming the output format. Neither is told to be elaborate and neither is told to
be brief, because a prompt that pushes either way decides the result. The brief
arm's extra input — the widget vocabulary and the `create_brief` schema, read
from the running MCP server rather than restated — is real and is counted.

It answers a narrower question than it looks like it does, and the answer is
close to level: both arms write the same prose, and only one also writes the
markup. Keep it for what it isolates, not as the headline — the headline is the
fork experiment above.

It earned its keep another way. Two of the first three briefs it generated would
have been **refused** by the API — snake_case field ids, and a `textarea` kind
that does not exist — because `/api/widgets` published the widget vocabulary and
not the field vocabulary. Agents had to guess, and guessed wrong. That is fixed,
and every run now records whether the brief would have been accepted.

## Reading the output

`results/runs/` holds one file per generation with its exact token counts, so the
arithmetic can be recomputed rather than believed. Output tokens are split into
thinking and document, because thinking is billed but is not the artefact.
