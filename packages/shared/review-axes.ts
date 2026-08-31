/**
 * Review Axes — the fixed set of dimensions every built-in review must cover.
 *
 * Tavernpunk fork addition. Plannotator ships a different default methodology
 * per engine family (Codex runs OpenAI's verbatim
 * `codex-rs/core/review_prompt.md`, the marker engines run a single-pass
 * investigation prompt, Claude runs our own single-pass prompt), and those
 * three disagreed about what is in scope: none of them mentioned performance,
 * Claude's hard constraints forbade flagging missing test coverage, and the
 * marker prompt listed "consider adding tests" and "this could be cleaner"
 * under Do NOT report.
 *
 * So the axes cannot simply be appended — an axis the surrounding prompt
 * forbids is dead text. This module owns the axis list ONCE, every engine now
 * renders it with `renderAxisChecklist`, and the suppressing constraints are
 * amended at their source (see claude-review.ts's hard constraints and
 * marker-review.ts's "Do NOT report" list).
 *
 * Claude's prompt used to render the axes as a parallel subagent roster
 * instead, one agent per axis. That was dropped along with the fan-out: the
 * roster guaranteed coverage by paying for the diff and the repo's guidance
 * files once per axis, which is why Claude reviews cost several times what the
 * other engines cost. One pass that holds all six axes in mind covers them for
 * one context.
 *
 * Scope: the BUILT-IN default review, on every engine. A custom review skill
 * (docs/custom-reviews.md) deliberately replaces the methodology wholesale —
 * picking one means "run this review instead" — so the axes are not injected
 * there, the same reason REPORTING_INSTRUCTIONS covers only how to report and
 * never what to look for.
 *
 * Runtime-agnostic; vendored to Pi.
 */

export interface ReviewAxis {
  /** Stable id, used by tests and by the checklist renderer. */
  id: string;
  /** Short name, becomes the checklist bullet's lead-in. */
  title: string;
  /** What this axis is responsible for. One paragraph, no line breaks. */
  focus: string;
}

/**
 * The axes, in the order they are rendered. Order is presentation only — every
 * engine is told to cover all of them.
 */
export const REVIEW_AXES: readonly ReviewAxis[] = [
  {
    id: "correctness",
    title: "Correctness",
    focus:
      "Logic errors, regressions, wrong results, broken or unhandled edge cases, off-by-one mistakes, and build or type breakage. Trace the changed code's actual call sites and data flow rather than judging the hunk in isolation.",
  },
  {
    id: "adversarial",
    title: "Adversarial",
    focus:
      "Attack the change's own assumptions instead of confirming them. What input, ordering, concurrency, partial failure, or resource exhaustion makes this code wrong? Look for state left inconsistent when a step fails midway, retries that are not idempotent, and invariants the author assumed but never enforced. This is about breaking the change, not about exploitability — that is the security axis.",
  },
  {
    id: "performance",
    title: "Performance",
    focus:
      "Algorithmic complexity regressions, repeated or quadratic work inside loops, N+1 access patterns, avoidable allocation or copying on hot paths, blocking work on latency-sensitive paths, and unbounded growth in memory or stored data. Flag it only where the changed code plausibly runs at a size or frequency that makes it matter, and say what that scale is.",
  },
  {
    id: "security",
    title: "Security",
    focus:
      "Exploit paths this change introduces: untrusted input reaching execution, queries, paths, or deserialization; weakened authentication, authorization, or trust boundaries; secrets exposed in output, logs, or storage; and newly exposed surface area. Require a plausible path to harm — no theoretical risks.",
  },
  {
    id: "scope",
    title: "Scope + Simplification",
    focus:
      "Does the change do more than the task requires? Look for unrelated edits riding along, dead or duplicated code, an existing utility or established pattern in this codebase that should have been reused, and a materially simpler shape with the same behavior. Read the surrounding code to learn the existing patterns before claiming one was missed.",
  },
  {
    id: "test-coverage",
    title: "Test Coverage",
    focus:
      "For the logic this change introduces or alters: is it tested, does the test exercise the failure path rather than only the happy one, and would a plausible regression actually be caught? Judge the changed code only — do not audit pre-existing coverage or ask for tests on trivial or mechanical changes.",
  },
];

/** Preamble, so the requirement reads the same way on every engine. */
const AXES_MANDATE =
  "Cover every axis below. They are required scope for this review, and they override any narrower framing earlier in these instructions — including anything that tells you not to raise performance or missing-test findings. An axis that turns up nothing real contributes nothing: report no finding for it rather than inventing one. Everything you do report still has to clear the evidence bar above.";

/**
 * Checklist rendering — the one rendering, used by every engine. Each default
 * prompt is a single pass of prose (Claude's own, Codex's upstream block, the
 * marker methodology), and the checklist is placed after that methodology so it
 * reads as additional required scope.
 */
export function renderAxisChecklist(): string {
  const items = REVIEW_AXES.map((axis) => `- **${axis.title}.** ${axis.focus}`).join("\n");
  return `## Required review axes\n\n${AXES_MANDATE}\n\n${items}`;
}
