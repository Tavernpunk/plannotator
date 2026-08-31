---
title: "AI Code Review Agents"
description: "Automated code review using Codex and Claude Code agents with live findings, severity classification, and full prompt transparency."
sidebar:
  order: 26
section: "Guides"
---

Launch AI review agents from the Plannotator diff viewer. Agents analyze your changes in the background and produce structured findings inline.

Two providers are supported:

- **Codex CLI** uses priority-based findings (P0 through P3)
- **Claude Code** uses a multi-agent pipeline with severity-based findings (Important, Nit, Pre-existing)

Both integrations are derived from official tooling. Claude's review model is based on Anthropic's [Claude Code Review](https://code.claude.com/docs/en/code-review) service and the open-source [code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md). Codex uses [OpenAI Codex CLI](https://github.com/openai/codex) structured output.

## Flow

1. Click **Run Agent** in the Agents tab (choose Codex or Claude)
2. The server builds the command with the appropriate prompt and schema
3. Agent runs in the background; live logs stream to the Logs tab
4. On completion, findings are parsed and appear as inline annotations

For PR reviews, a temporary local checkout is created by default so the agent has file access beyond the diff. Pass `--no-local` to skip this.

For stacked PRs and MRs, the review header lets you choose what the agent sees:

- **Layer** reviews only the current PR or MR relative to its parent branch.
- **Full stack** reviews the cumulative diff from the repository default branch through the current head.

Layer review is best for avoiding duplicate feedback on parent PRs. Full stack review is useful for integration issues that only appear when the whole chain is considered together. Posting inline comments back to GitHub or GitLab stays limited to Layer because platform comments must anchor to the platform diff.

## Findings

Each finding includes a file path, line range, description, and severity or priority. Claude findings also include a reasoning trace that explains how the issue was verified.

Click any finding to navigate to the relevant file and line. Use the copy button on individual findings or "Copy All" to export as markdown.

### Severity (Claude)

| Level | Meaning |
|-------|---------|
| **Important** | Fix before merging. Build failures, logic errors, security issues. |
| **Nit** | Worth fixing, not blocking. Style, edge cases, code quality. |
| **Pre-existing** | Bug in surrounding code, not introduced by this PR. |

### Priority (Codex)

| Level | Meaning |
|-------|---------|
| **P0** | Blocking. Drop everything. |
| **P1** | Urgent. Next cycle. |
| **P2** | Normal. Fix eventually. |
| **P3** | Low. Nice to have. |

## Local worktree

PR and MR reviews automatically create a temporary checkout so agents can read files, follow imports, and understand the codebase.

- **Same-repo**: git worktree (shared objects, fast)
- **Cross-repo**: shallow clone with targeted PR head fetch

Cleaned up when the session ends. Use `--no-local` to review in remote-only mode.

## Transparency

Review-agent permissions depend on the engine:

- **Claude** gets Read, Glob, Grep, Agent, and command patterns intended for inspection through `git`, `gh`, `glab`, `jj`, and `wc`. Direct file-writing tools, WebFetch, WebSearch, general-purpose shells, curl, and wget are denied. Some allowed patterns, including `glab api` and `git -C`, are broader than a strict subcommand-by-subcommand read-only list.
- **GitHub Copilot CLI** has its write tool denied. Plannotator also denies specific high-risk Git operations and outward-facing GitHub and GitLab writes, allows the `git`, `gh`, `glab`, `jj`, and `wc` command families, and relies on Copilot's non-interactive mode to deny other shell tools.
- **Codex** runs with `--approve-for-me`, which uses Codex's workspace-write sandbox and automatic approval review. It is not a read-only file sandbox.
- **Cursor** runs in ask mode with its sandbox enabled by default. `PLANNOTATOR_CURSOR_SANDBOX=0` removes the explicit sandbox flag and defers to the user's Cursor configuration.
- **OpenCode** runs its plan agent, but Plannotator does not add a shell restriction flag. Its permissions come from the user's OpenCode configuration.
- **Pi** excludes the direct edit and write tools, but retains Bash and its other inspection paths under Pi's runtime controls.

Plannotator's prompts tell every engine not to modify files or post comments. That instruction is visible in the review UI, but it is not structural enforcement for Codex, Cursor, OpenCode, or Pi. Claude and Copilot add structural restrictions, but those restrictions should be understood as the exact rules above rather than a blanket read-only sandbox. PR and MR reviews normally run in disposable worktrees; local working-tree reviews do not. The selected AI provider receives the prompt and repository or diff context needed for the review. No code is routed through a Plannotator-operated model server. Provider retention and account controls come from the CLI and provider you configured.

Below are the exact prompts, commands, and schemas used.

- [Claude Code: full prompt](#claude-code-full-prompt)
- [Claude Code: command](#claude-code-command)
- [Codex: full prompt](#codex-full-prompt)
- [Codex: command](#codex-command)
- [Codex: output schema](#codex-output-schema)

---

### Claude Code: full prompt

```
# Claude Code Review System Prompt

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
  What you establish while confirming it IS the `reasoning` field: what
  triggers it, what breaks, and why it is not already handled.

## Required review axes

Cover every axis below. They are required scope for this review, and they override any narrower framing earlier in these instructions — including anything that tells you not to raise performance or missing-test findings. An axis that turns up nothing real contributes nothing: report no finding for it rather than inventing one. Everything you do report still has to clear the evidence bar above.

- **Correctness.** Logic errors, regressions, wrong results, broken or unhandled edge cases, off-by-one mistakes, and build or type breakage. Trace the changed code's actual call sites and data flow rather than judging the hunk in isolation.
- **Adversarial.** Attack the change's own assumptions instead of confirming them. What input, ordering, concurrency, partial failure, or resource exhaustion makes this code wrong? Look for state left inconsistent when a step fails midway, retries that are not idempotent, and invariants the author assumed but never enforced. This is about breaking the change, not about exploitability — that is the security axis.
- **Performance.** Algorithmic complexity regressions, repeated or quadratic work inside loops, N+1 access patterns, avoidable allocation or copying on hot paths, blocking work on latency-sensitive paths, and unbounded growth in memory or stored data. Flag it only where the changed code plausibly runs at a size or frequency that makes it matter, and say what that scale is.
- **Security.** Exploit paths this change introduces: untrusted input reaching execution, queries, paths, or deserialization; weakened authentication, authorization, or trust boundaries; secrets exposed in output, logs, or storage; and newly exposed surface area. Require a plausible path to harm — no theoretical risks.
- **Scope + Simplification.** Does the change do more than the task requires? Look for unrelated edits riding along, dead or duplicated code, an existing utility or established pattern in this codebase that should have been reused, and a materially simpler shape with the same behavior. Read the surrounding code to learn the existing patterns before claiming one was missed.
- **Test Coverage.** For the logic this change introduces or alters: is it tested, does the test exercise the failure path rather than only the happy one, and would a plausible regression actually be caught? Judge the changed code only — do not audit pre-existing coverage or ask for tests on trivial or mechanical changes.

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
- Your only output is the structured JSON findings
```

### Claude Code: command

```bash
claude -p \
  --permission-mode dontAsk \
  --output-format stream-json \
  --verbose \
  --json-schema '{"type":"object","properties":{"findings":{"type":"array","items":{"type":"object","properties":{"severity":{"type":"string","enum":["important","nit","pre_existing"]},"file":{"type":["string","null"]},"line":{"type":["integer","null"]},"end_line":{"type":["integer","null"]},"description":{"type":"string"},"reasoning":{"type":"string"}},"required":["severity","file","line","end_line","description","reasoning"],"additionalProperties":false}},"summary":{"type":"object","properties":{"important":{"type":"integer"},"nit":{"type":"integer"},"pre_existing":{"type":"integer"}},"required":["important","nit","pre_existing"],"additionalProperties":false}},"required":["findings","summary"],"additionalProperties":false}' \
  --no-session-persistence \
  --model claude-opus-5 \
  --tools Bash,Read,Glob,Grep \
  --allowedTools 'Read,Glob,Grep,Bash(gh pr view:*),Bash(gh pr diff:*),Bash(gh pr list:*),Bash(gh issue view:*),Bash(gh issue list:*),Bash(gh api repos/*/*/pulls/*),Bash(gh api repos/*/*/pulls/*/files*),Bash(gh api repos/*/*/pulls/*/comments*),Bash(gh api repos/*/*/issues/*/comments*),Bash(glab mr view:*),Bash(glab mr diff:*),Bash(glab mr list:*),Bash(glab api:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*),Bash(git show:*),Bash(git blame:*),Bash(git branch:*),Bash(git grep:*),Bash(git ls-remote:*),Bash(git ls-tree:*),Bash(git merge-base:*),Bash(git remote:*),Bash(git rev-parse:*),Bash(git show-ref:*),Bash(git -C:*),Bash(jj status:*),Bash(jj diff:*),Bash(jj log:*),Bash(jj show:*),Bash(jj file show:*),Bash(jj cat:*),Bash(jj bookmark list:*),Bash(wc:*)' \
  --disallowedTools Agent,Edit,Write,NotebookEdit,WebFetch,WebSearch,Bash(python:*),Bash(python3:*),Bash(node:*),Bash(npx:*),Bash(bun:*),Bash(bunx:*),Bash(sh:*),Bash(bash:*),Bash(zsh:*),Bash(curl:*),Bash(wget:*)
```

Prompt is written to stdin.

---

### Codex: full prompt

```
# Review guidelines:

You are acting as a reviewer for a proposed code change made by another engineer.

Below are some default guidelines for determining whether the original author
would appreciate the issue being flagged.

These are not the final word in determining whether an issue is a bug. In many
cases, you will encounter other, more specific guidelines. These may be present
elsewhere in a developer message, a user message, a file, or even elsewhere in
this system message. Those guidelines should be considered to override these
general instructions.

Here are the general guidelines for determining whether something is a bug and
should be flagged.

1. It meaningfully impacts the accuracy, performance, security, or
   maintainability of the code.
2. The bug is discrete and actionable (i.e. not a general issue with the
   codebase or a combination of multiple issues).
3. Fixing the bug does not demand a level of rigor that is not present in the
   rest of the codebase.
4. The bug was introduced in the commit (pre-existing bugs should not be
   flagged).
5. The author of the original PR would likely fix the issue if they were made
   aware of it.
6. The bug does not rely on unstated assumptions about the codebase or
   author's intent.
7. It is not enough to speculate that a change may disrupt another part of the
   codebase; to be considered a bug, one must identify the other parts of the
   code that are provably affected.
8. The bug is clearly not just an intentional change by the original author.

Comment guidelines:

1. Clear about why the issue is a bug.
2. Appropriately communicates severity. Does not overclaim.
3. Brief. Body is at most 1 paragraph.
4. No code chunks longer than 3 lines.
5. Clearly communicates the scenarios or inputs necessary for the bug to arise.
6. Tone is matter-of-fact, not accusatory or overly positive.
7. Written so the original author can immediately grasp the idea.
8. Avoids flattery ("Great job ...", "Thanks for ...").

Output all findings that the original author would fix if they knew about it. If
there is no finding that a person would definitely love to see and fix, prefer
outputting no findings.

Priority tags: [P0] Blocking. [P1] Urgent. [P2] Normal. [P3] Low.

At the end, output an overall correctness verdict.
```

### Codex: command

```bash
codex exec \
  --output-schema ~/.plannotator/codex-review-schema.json \
  -o /tmp/plannotator-codex-<uuid>.json \
  --approve-for-me \
  --ephemeral \
  -C <working-directory> \
  "<system-prompt>\n\n---\n\n<user-message>"
```

### Codex: output schema

```json
{
  "type": "object",
  "properties": {
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "body": { "type": "string" },
          "confidence_score": { "type": "number" },
          "priority": { "type": ["integer", "null"] },
          "code_location": {
            "type": "object",
            "properties": {
              "absolute_file_path": { "type": "string" },
              "line_range": {
                "type": "object",
                "properties": {
                  "start": { "type": "integer" },
                  "end": { "type": "integer" }
                },
                "required": ["start", "end"]
              }
            },
            "required": ["absolute_file_path", "line_range"]
          }
        },
        "required": ["title", "body", "confidence_score", "priority", "code_location"]
      }
    },
    "overall_correctness": { "type": "string" },
    "overall_explanation": { "type": "string" },
    "overall_confidence_score": { "type": "number" }
  },
  "required": ["findings", "overall_correctness", "overall_explanation", "overall_confidence_score"]
}
```

## Customization

Add `CLAUDE.md` or `REVIEW.md` to your repo root or any subdirectory. The Claude agent reads them to understand project rules.

```markdown
# Review Rules

- Check for SQL injection in database queries
- Skip files in test-fixtures/
- Enforce snake_case in Python
```

Both files are additive. REVIEW.md extends CLAUDE.md for review-specific guidance.
