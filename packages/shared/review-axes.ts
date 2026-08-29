/**
 * Review Axes — the fixed set of dimensions every built-in review must cover.
 *
 * Tavernpunk fork addition. Plannotator ships a different default methodology
 * per engine family (Claude fans out parallel subagents, Codex runs OpenAI's
 * verbatim `codex-rs/core/review_prompt.md`, the marker engines run a
 * single-pass investigation prompt), and those three disagree about what is in
 * scope: none of them mentions performance, Claude's hard constraints forbid
 * flagging missing test coverage, and the marker prompt lists "consider adding
 * tests" and "this could be cleaner" under Do NOT report.
 *
 * So the axes cannot simply be appended — an axis the surrounding prompt
 * forbids is dead text. This module owns the axis list ONCE; each engine's
 * composer renders it in the shape that engine's prompt actually uses, and the
 * suppressing constraints are amended at their source (see claude-review.ts's
 * hard constraints and marker-review.ts's "Do NOT report" list).
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
  /** Stable id, used by tests and by the per-engine renderers. */
  id: string;
  /** Short name, becomes the agent name on Claude and the bullet on the rest. */
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

/** Preamble shared by both renderings, so the requirement reads the same way. */
const AXES_MANDATE =
  "Cover every axis below. They are required scope for this review, and they override any narrower framing earlier in these instructions — including anything that tells you not to raise performance or missing-test findings. An axis that turns up nothing real contributes nothing: report no finding for it rather than inventing one. Everything you do report still has to clear the evidence bar above.";

/**
 * Checklist rendering — for engines whose default prompt is a single pass of
 * prose (Codex, and the marker engines). Appended after the engine's own
 * methodology so it reads as additional required scope.
 */
export function renderAxisChecklist(): string {
  const items = REVIEW_AXES.map((axis) => `- **${axis.title}.** ${axis.focus}`).join("\n");
  return `## Required review axes\n\n${AXES_MANDATE}\n\n${items}`;
}

/**
 * Agent-roster rendering — for Claude, whose default prompt already fans out
 * parallel subagents. One agent per axis guarantees the axis is actually
 * exercised, which an appended checklist would not: the four original agents
 * cover correctness, security and quality, and nothing would own performance
 * or test coverage.
 *
 * `startIndex` is the first agent number, so the caller can keep its own
 * additional agents (guideline compliance) numbered after these.
 */
export function renderAxisAgentRoster(startIndex = 1): string {
  return REVIEW_AXES.map((axis, i) =>
    [`  Agent ${startIndex + i} — ${axis.title}`, indentWrap(axis.focus, 4, 72)].join("\n"),
  ).join("\n\n");
}

/** The agent number following the axis roster. */
export function axisAgentCount(): number {
  return REVIEW_AXES.length;
}

/**
 * Greedy word wrap at `width` columns with a fixed indent — matches the hand
 * formatting of the surrounding prompt so the rendered roster is not visually
 * distinguishable from the prose around it.
 */
function indentWrap(text: string, indent: number, width: number): string {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && pad.length + line.length + 1 + word.length > width) {
      lines.push(pad + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(pad + line);
  return lines.join("\n");
}
