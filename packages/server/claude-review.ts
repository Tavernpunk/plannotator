import {
  composeReviewPrompt,
  type ResolvedReviewProfile,
} from "@plannotator/shared/review-profiles";
import { renderAxisChecklist } from "@plannotator/shared/review-axes";
import {
  transformSeverityFindings,
  type ReviewSeverity,
  type ReviewFinding,
  type ReviewAnnotationInput,
} from "./review-findings";

/**
 * Claude Code Review Agent — prompt, command builder, and JSONL output parser.
 *
 * Claude has its own review model (severity-based findings with reasoning traces)
 * separate from Codex's priority-based model. The transform layer normalizes
 * both into the shared annotation format.
 *
 * Claude uses --json-schema (inline JSON + Ajv validation with retries) and
 * --output-format stream-json for live JSONL streaming. The final event is
 * type:"result" with structured_output containing validated findings.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Claude findings ARE review findings — reuse the one shared shape from
// review-findings.ts rather than keeping a byte-identical copy that can drift.
export type ClaudeSeverity = ReviewSeverity;
export type ClaudeFinding = ReviewFinding;

export interface ClaudeReviewOutput {
  findings: ClaudeFinding[];
  summary: {
    important: number;
    nit: number;
    pre_existing: number;
  };
}

// ---------------------------------------------------------------------------
// Schema — Claude's own severity-based model
// ---------------------------------------------------------------------------

export const CLAUDE_REVIEW_SCHEMA_JSON = JSON.stringify({
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["important", "nit", "pre_existing"] },
          // Nullable, not omitted: keep every property in `required` so the
          // schema is valid under strict structured-output validators too. A
          // whole-file finding sets line/end_line null; a general finding also
          // sets file null.
          file: { type: ["string", "null"] },
          line: { type: ["integer", "null"] },
          end_line: { type: ["integer", "null"] },
          description: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["severity", "file", "line", "end_line", "description", "reasoning"],
        additionalProperties: false,
      },
    },
    summary: {
      type: "object",
      properties: {
        important: { type: "integer" },
        nit: { type: "integer" },
        pre_existing: { type: "integer" },
      },
      required: ["important", "nit", "pre_existing"],
      additionalProperties: false,
    },
  },
  required: ["findings", "summary"],
  additionalProperties: false,
});

// ---------------------------------------------------------------------------
// Review prompt — converges open-source Claude Code review + remote service
// ---------------------------------------------------------------------------

// Tavernpunk fork: the required review axes
// (@plannotator/shared/review-axes) are appended here as a checklist, the same
// rendering Codex and the marker engines get.
//
// This prompt used to fan out — one subagent per axis, then one validation
// subagent per candidate finding. That bought axis coverage with two sequential
// waves of cold-context subagents, each re-reading the diff and the repo's
// guidance files, which made Claude reviews cost several times what Codex and
// the marker engines cost in both tokens and wall clock for comparable
// coverage. The axes are required scope either way; a single pass that holds
// all six in mind while it reads each hunk once covers them without paying for
// the same context six times. `buildClaudeCommand` withholds the Agent tool so
// the fan-out cannot come back by model initiative.
const AXIS_CHECKLIST = renderAxisChecklist();

export const CLAUDE_REVIEW_PROMPT = `# Claude Code Review System Prompt

## Identity
You are a code review system. Your job is to find bugs that would break
production. You are not a linter, formatter, or style checker unless
project guidance files explicitly expand your scope.

## Method
Review the change yourself, in ONE pass. You have no subagents — do not try to
delegate. Hold every required axis below in mind as you read, so one read of a
hunk answers all of them, and spend your reading budget on the changes that
could actually be wrong rather than on uniform coverage of the diff.

Step 1: Gather context, cheaply
  - Read the diff once (gh pr diff, git diff, or jj diff).
  - Read the guidance that governs the changed paths: CLAUDE.md, AGENTS.md,
    and REVIEW.md at the repo root and in the directories holding modified
    files. When one of those files is large, grep it for the changed paths and
    the subsystems they belong to instead of reading it end to end.
  - Note the skip rules (paths, patterns, file types to ignore) before you
    start reading code, so you never spend a read on an excluded path.

Step 2: Review the diff against every required axis
  Go file by file. For each change that could plausibly be wrong:
  - Read the enclosing function and module, not just the hunk.
  - Trace its call sites and data flow — grep for callers before claiming a
    contract broke or a value cannot be null.
  - Check sibling code and tests: is the pattern you are about to flag used
    safely elsewhere, or the failure path already covered?
  Skip what carries no risk — comments, generated files, mechanical renames,
  pure formatting. Re-read a file only when a specific suspicion needs it.

Step 3: Confirm each candidate the moment you form it
  Do not collect candidates and audit them afterwards.
  - Trace the actual path that triggers the issue.
  - Check whether it is already handled: a guard, try/catch, fallback,
    upstream validation, or a type-system guarantee.
  - If you cannot show how it triggers, drop it. Prefer silence over a false
    positive.
  What you establish while confirming it IS the \`reasoning\` field: what
  triggers it, what breaks, and why it is not already handled.

${AXIS_CHECKLIST}

## Guideline compliance
Also flag clear, unambiguous violations of the guidance files from Step 1, and
cite the exact rule broken. If the change makes a documented statement
outdated, flag that the docs need updating. Respect every skip rule — never
flag files or patterns the guidance says to ignore.

## Severity
Assign exactly one severity per finding:

  important — A bug that should be fixed before merging. Build failures,
    clear logic errors, security vulnerabilities with exploit paths, data
    loss risks, race conditions with observable consequences.

  nit — A minor issue worth fixing but non-blocking. Style deviations
    from project guidelines, code quality concerns, edge cases that are
    unlikely but worth noting, convention violations that don't affect
    correctness.

  pre_existing — A bug that exists in the surrounding codebase but was
    NOT introduced by this PR. Only flag when directly relevant to the
    changed code path.

## Output
Return structured JSON output matching the schema.
  - Merge findings that describe the same underlying issue — keep the most
    specific description and the highest severity.
  - Sort by severity (important → nit → pre_existing), then by file path and
    line number.
  - Place each finding by how specific it is: give file and line for a
    line-level issue; give file and set line null for a whole-file issue; set
    file and line null for a general, review-level note. Never invent a line
    you are unsure of — drop to a file or general placement instead of
    guessing.
  - If no issues are found, return an empty findings array with zeroed summary.

## Hard constraints
- Never approve or block the PR
- Never comment on formatting or code style unless guidance files say to
- Missing test coverage is in scope, but only as the Test Coverage axis
  defines it: the logic this change introduces or alters. Never audit
  pre-existing coverage or ask for tests on trivial or mechanical changes
- Never invent rules — only enforce what CLAUDE.md, AGENTS.md or REVIEW.md state
- Never flag issues in skipped paths or generated files unless guidance
  explicitly includes them
- Prefer silence over false positives — when in doubt, drop the finding
- This is a read-only review. Do NOT modify files
- Do NOT post any comments to GitHub or GitLab
- Do NOT use gh pr comment or any commenting tool
- Your only output is the structured JSON findings`;

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

/**
 * Compose Claude's review prompt: the immutable system prompt, the resolved
 * profile's Custom Review Profile section (omitted for builtin:default), then
 * the user review message. For builtin:default / no profile the output is
 * byte-identical to today's `CLAUDE_REVIEW_PROMPT + "\n\n---\n\n" + userMessage`.
 */
export function composeClaudeReviewPrompt(
  userMessage: string,
  reviewProfile?: ResolvedReviewProfile,
): string {
  return composeReviewPrompt(CLAUDE_REVIEW_PROMPT, reviewProfile, userMessage);
}

// ---------------------------------------------------------------------------
// Command builder
// ---------------------------------------------------------------------------

export interface ClaudeCommandResult {
  command: string[];
  /** Prompt text to write to stdin (Claude reads prompt from stdin, not argv). */
  stdinPrompt: string;
}

/**
 * Build the `claude -p` command. Prompt is passed via stdin, not as a
 * positional arg — avoids quoting issues, argv limits, and variadic flag conflicts.
 *
 * Tavernpunk fork: the Agent tool is deliberately withheld (absent from
 * `--tools` and `--allowedTools`, and named in `--disallowedTools` so an
 * attempted delegation fails loudly rather than silently). CLAUDE_REVIEW_PROMPT
 * is a single pass, matching Codex and the marker engines, and subagents were
 * the whole reason Claude reviews cost several times what those engines cost:
 * each one starts cold and re-reads the diff plus this repo's guidance files.
 * Prompt text alone would not hold — a model that finds a large diff daunting
 * reaches for parallelism on its own initiative.
 */
export function buildClaudeCommand(prompt: string, model: string = "claude-opus-5", effort?: string, binary?: string): ClaudeCommandResult {
  const allowedTools = [
    "Read", "Glob", "Grep",
    // GitHub CLI
    "Bash(gh pr view:*)", "Bash(gh pr diff:*)", "Bash(gh pr list:*)",
    "Bash(gh issue view:*)", "Bash(gh issue list:*)",
    "Bash(gh api repos/*/*/pulls/*)", "Bash(gh api repos/*/*/pulls/*/files*)",
    "Bash(gh api repos/*/*/pulls/*/comments*)", "Bash(gh api repos/*/*/issues/*/comments*)",
    // GitLab CLI
    "Bash(glab mr view:*)", "Bash(glab mr diff:*)", "Bash(glab mr list:*)",
    "Bash(glab api:*)",
    // Git (read-only)
    "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)",
    "Bash(git show:*)", "Bash(git blame:*)", "Bash(git branch:*)",
    "Bash(git grep:*)", "Bash(git ls-remote:*)", "Bash(git ls-tree:*)",
    "Bash(git merge-base:*)", "Bash(git remote:*)", "Bash(git rev-parse:*)",
    "Bash(git show-ref:*)", "Bash(git -C:*)",
    // JJ (read-only)
    "Bash(jj status:*)", "Bash(jj diff:*)", "Bash(jj log:*)",
    "Bash(jj show:*)", "Bash(jj file show:*)", "Bash(jj cat:*)",
    "Bash(jj bookmark list:*)",
    "Bash(wc:*)",
  ].join(",");

  const disallowedTools = [
    "Agent",
    "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch",
    "Bash(python:*)", "Bash(python3:*)", "Bash(node:*)", "Bash(npx:*)",
    "Bash(bun:*)", "Bash(bunx:*)", "Bash(sh:*)", "Bash(bash:*)", "Bash(zsh:*)",
    "Bash(curl:*)", "Bash(wget:*)",
  ].join(",");

  return {
    command: [
      // Agent variants may re-point the binary; everything else is unchanged.
      binary || "claude", "-p",
      "--permission-mode", "dontAsk",
      "--output-format", "stream-json",
      "--verbose",
      "--json-schema", CLAUDE_REVIEW_SCHEMA_JSON,
      "--no-session-persistence",
      "--model", model,
      ...(effort ? ["--effort", effort] : []),
      "--tools", "Bash,Read,Glob,Grep",
      "--allowedTools", allowedTools,
      "--disallowedTools", disallowedTools,
    ],
    stdinPrompt: prompt,
  };
}

// ---------------------------------------------------------------------------
// JSONL stream output parser
// ---------------------------------------------------------------------------

/**
 * Parse Claude Code's stream-json output (JSONL).
 * Extracts structured_output from the final type:"result" event.
 */
export function parseClaudeStreamOutput(stdout: string): ClaudeReviewOutput | null {
  if (!stdout.trim()) return null;

  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const event = JSON.parse(line);

      if (event.type === 'result') {
        if (event.is_error) return null;

        const output = event.structured_output;
        if (!output || !Array.isArray(output.findings)) return null;

        return output as ClaudeReviewOutput;
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Finding transform — Claude findings → external annotations
// ---------------------------------------------------------------------------

/** Transform Claude findings into the external annotation format. */
export function transformClaudeFindings(
  findings: ClaudeFinding[],
  source: string,
  cwd?: string,
  pathTransform?: (path: string) => string,
): ReviewAnnotationInput[] {
  // Routing (line / whole-file / general) is shared with the marker engines in
  // review-findings.ts — nothing is dropped; only the author differs.
  return transformSeverityFindings(findings, source, "Claude Code", cwd, pathTransform);
}

// ---------------------------------------------------------------------------
// Live log formatter
// ---------------------------------------------------------------------------

/**
 * Extract log-worthy content from a JSONL line for the LiveLogViewer.
 * Returns a human-readable string, or null if the line should be skipped.
 */
export function formatClaudeLogEvent(line: string): string | null {
  try {
    const event = JSON.parse(line);

    // Skip the final result event — handled separately
    if (event.type === 'result') return null;

    // Assistant messages (the agent's thinking/responses)
    if (event.type === 'assistant' && event.message?.content) {
      const parts = Array.isArray(event.message.content) ? event.message.content : [event.message.content];
      const texts = parts
        .filter((p: any) => p.type === 'text' && p.text)
        .map((p: any) => p.text);
      if (texts.length > 0) return texts.join('\n');

      // Tool use events (only reached if no text parts found)
      const tools = parts.filter((p: any) => p.type === 'tool_use');
      if (tools.length > 0) {
        return tools.map((t: any) => `[${t.name}] ${typeof t.input === 'string' ? t.input.slice(0, 100) : JSON.stringify(t.input).slice(0, 100)}`).join('\n');
      }
    }

    return null;
  } catch {
    return null;
  }
}
