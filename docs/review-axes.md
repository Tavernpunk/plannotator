# Required Review Axes

> Tavernpunk fork addition.

Every built-in code review, on every engine, must cover six axes:

| Axis | Responsible for |
|------|-----------------|
| Correctness | Logic errors, regressions, wrong results, broken edge cases, build/type breakage |
| Adversarial | Attacking the change's own assumptions — input, ordering, concurrency, partial failure, unenforced invariants |
| Performance | Complexity regressions, repeated work in loops, N+1, hot-path allocation, unbounded growth |
| Security | Exploit paths the change introduces, with a plausible path to harm |
| Scope + Simplification | Doing more than needed, dead or duplicated code, a utility that should have been reused, a simpler shape |
| Test Coverage | Whether the changed logic is tested, including its failure path |

The list lives in one place: `packages/shared/review-axes.ts`. Edit it there
and every engine picks it up.

## Why it isn't one appended paragraph

Plannotator ships a different default methodology per engine family, and those
methodologies disagreed about what is in scope. Appending the axes alone would
have left two of the six as dead text:

- **Claude's** hard constraints said `Never flag missing test coverage unless
  guidance files say to`.
- **The marker methodology** (Cursor / OpenCode / Pi / Copilot) listed
  `"Consider adding tests"` and speculative simplification under **Do NOT
  report**.
- **None** of the three prompts mentioned performance at all.

So each engine renders the shared list in the shape its own prompt uses, and
the suppressing constraints were amended at their source.

| Engine | How the axes are embedded |
|--------|---------------------------|
| Claude | **As the parallel agent roster.** Its default prompt already fans out subagents, so Step 2 launches one agent per axis plus the original Guideline Compliance agent. An appended checklist would have left performance and test coverage unowned — the four stock agents covered neither. |
| Codex | **Appended as a checklist** after the system block. That block is copied verbatim from `codex-rs/core/review_prompt.md` and is kept byte-identical to upstream so it can be re-synced, so it is never edited in place. |
| Cursor / OpenCode / Pi / Copilot | **Appended as a checklist** after the methodology and before the marker output contract. |

The checklist carries an explicit override line, because Codex's upstream
prompt is bug-focused and tells the model to prefer reporting nothing — without
it, the performance and test-coverage axes lose to that framing.

## Custom review skills are not affected

Selecting a custom review (`docs/custom-reviews.md`) replaces the methodology
wholesale — that is what picking one means. The axes are not injected there,
for the same reason `REPORTING_INSTRUCTIONS` covers only *how* to report and
never *what* to look for: an appended "what" would compete with the skill's own
method. A custom marker review still gets the output contract, since without it
the engine's prose output is unparseable.

If you want the axes on custom reviews too, drop the `profileHasCustomSection`
branch in each composer — one line per engine.

## Adding or changing an axis

Edit `REVIEW_AXES` in `packages/shared/review-axes.ts`. Keep `focus` on a single
line (the roster renderer controls its own wrapping). `packages/server/review-axes.test.ts`
asserts every axis reaches all three engine families, so a half-wired axis fails
the suite rather than silently narrowing reviews.
