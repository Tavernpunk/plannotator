import { describe, expect, test } from "bun:test";
import { REVIEW_AXES, renderAxisChecklist } from "@plannotator/shared/review-axes";
import { CLAUDE_REVIEW_PROMPT, buildClaudeCommand, composeClaudeReviewPrompt } from "./claude-review";
import { composeCodexReviewPrompt } from "./codex-review";
import { composeMarkerReviewPrompt } from "./marker-review";
import type { ResolvedReviewProfile } from "@plannotator/shared/review-profiles";

/**
 * Required review axes (Tavernpunk fork).
 *
 * The failure this guards: an axis reaching a prompt as dead text. Two of the
 * six were actively suppressed by the stock prompts — Claude's hard constraints
 * forbade flagging missing test coverage, and the marker methodology listed
 * "consider adding tests" and speculative simplification under Do NOT report —
 * and none of the three mentioned performance. A future edit that restores
 * either suppression, or that adds an axis without covering every engine,
 * silently narrows every review this fork runs.
 */

const CUSTOM: ResolvedReviewProfile = {
  id: "skill:security-review",
  label: "security-review",
  instructions: "MY SKILL BODY",
  source: "user",
};

const NONCE = "pn0123456789ab";

describe("axis catalog", () => {
  test("ids are unique and stable", () => {
    // Ids are how the renderers and these tests address an axis.
    const ids = REVIEW_AXES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "correctness",
      "adversarial",
      "performance",
      "security",
      "scope",
      "test-coverage",
    ]);
  });

  test("every axis carries a non-trivial focus on one line", () => {
    for (const axis of REVIEW_AXES) {
      expect(axis.title.length).toBeGreaterThan(0);
      // One line per focus keeps the rendered checklist one bullet per axis.
      expect(axis.focus).not.toContain("\n");
      expect(axis.focus.length).toBeGreaterThan(80);
    }
  });
});

describe("every default review prompt covers every axis", () => {
  // The point of the fork: one canonical list, reaching all three engine
  // families. Adding an axis without wiring an engine fails here.
  const prompts: Array<[string, string]> = [
    ["claude", composeClaudeReviewPrompt("USER", undefined)],
    ["codex", composeCodexReviewPrompt("USER", undefined)],
    ["marker", composeMarkerReviewPrompt(undefined, "USER", NONCE)],
  ];

  for (const [engine, prompt] of prompts) {
    test(`${engine}`, () => {
      for (const axis of REVIEW_AXES) {
        expect(prompt).toContain(axis.title);
      }
    });
  }
});

describe("suppressions that would nullify an axis stay lifted", () => {
  test("Claude no longer forbids flagging missing test coverage", () => {
    // The stock hard constraint read "Never flag missing test coverage unless
    // guidance files say to", which would have made the Test Coverage axis a
    // no-op wherever it appeared.
    expect(CLAUDE_REVIEW_PROMPT).not.toContain("Never flag missing test coverage");
    expect(CLAUDE_REVIEW_PROMPT).toContain("Missing test coverage is in scope");
  });

  test("the marker methodology no longer files added tests under Do NOT report", () => {
    const prompt = composeMarkerReviewPrompt(undefined, "USER", NONCE);
    expect(prompt).not.toContain('"Consider adding tests"');
  });
});

describe("Claude's default review is a single pass", () => {
  /**
   * The failure this guards: the subagent fan-out coming back. Claude's prompt
   * used to launch one review agent per axis and then one validation agent per
   * candidate finding, which paid for the diff and this repo's guidance files
   * once per agent — several times the tokens and wall clock of the other
   * engines for comparable coverage. Coverage now comes from the shared
   * checklist inside one pass, and the command withholds the Agent tool so a
   * model that finds a big diff daunting cannot re-introduce the fan-out on its
   * own initiative.
   */
  const prompt = composeClaudeReviewPrompt("USER", undefined);

  test("the axes arrive as the shared checklist, not a roster", () => {
    expect(prompt).toContain(renderAxisChecklist());
    expect(prompt).not.toMatch(/Agent \d+ —/);
    expect(prompt).not.toContain("parallel review agents");
    expect(prompt).not.toContain("validation agent");
  });

  test("guideline compliance survives the roster's removal", () => {
    // It was Agent 7. Dropping the roster must not drop the axis-adjacent scope
    // that only that agent carried.
    expect(prompt).toContain("## Guideline compliance");
    expect(prompt).toContain("cite the exact rule broken");
  });

  test("the review command grants no subagent tool", () => {
    const command = buildClaudeCommand("review").command;
    const tools = command[command.indexOf("--tools") + 1];
    const allowed = command[command.indexOf("--allowedTools") + 1];
    const disallowed = command[command.indexOf("--disallowedTools") + 1];

    expect(tools.split(",")).not.toContain("Agent");
    expect(allowed.split(",")).not.toContain("Agent");
    expect(disallowed.split(",")).toContain("Agent");
  });
});

describe("custom review skills are left alone", () => {
  // A skill replaces the methodology wholesale — that is what selecting one
  // means. Injecting axes there would compete with the skill's own method,
  // the same reason REPORTING_INSTRUCTIONS covers only how to report.
  test.each([
    ["claude", () => composeClaudeReviewPrompt("USER", CUSTOM)],
    ["codex", () => composeCodexReviewPrompt("USER", CUSTOM)],
    ["marker", () => composeMarkerReviewPrompt(CUSTOM, "USER", NONCE)],
  ])("%s", (_engine, compose) => {
    const prompt = compose();
    expect(prompt).toContain("MY SKILL BODY");
    expect(prompt).not.toContain("## Required review axes");
  });

  test("a custom marker review still gets the output contract", () => {
    // Without it the engine's prose output is unparseable, axes or not.
    expect(composeMarkerReviewPrompt(CUSTOM, "USER", NONCE)).toContain("## Output contract");
  });
});

describe("prompt structure is preserved", () => {
  test("the axes precede the user message on every engine", () => {
    for (const prompt of [
      composeClaudeReviewPrompt("USER_SENTINEL", undefined),
      composeCodexReviewPrompt("USER_SENTINEL", undefined),
      composeMarkerReviewPrompt(undefined, "USER_SENTINEL", NONCE),
    ]) {
      expect(prompt.indexOf("Correctness")).toBeLessThan(prompt.indexOf("USER_SENTINEL"));
    }
  });

  test("the checklist mandate overrides narrower framing above it", () => {
    // Codex's verbatim upstream prompt is bug-focused and tells the model to
    // prefer reporting nothing; without this line the performance and
    // test-coverage axes lose to it.
    expect(renderAxisChecklist()).toContain("override any narrower framing");
  });
});
