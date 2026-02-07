---
name: ship
description: Review all code changes, run lint + tests, then commit and push. Blocks commit if review finds issues.
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(export PATH*), Bash(uv run *), Bash(make *), Read, Grep, Glob
argument-hint: "[optional commit message]"
---

# Ship — Review, Test, Commit, Push

Follow these steps strictly in order.

## Step 1: Review Changes

1. Run `git status` and `git diff` (both staged and unstaged)
2. Read every changed file **in full** (not just the diff) and review for:
   - **Bugs**: Logic errors, off-by-one, null/undefined handling, race conditions
   - **Security**: Hardcoded secrets, injection risks, exposed PII, missing auth checks
   - **Style**: Matches project patterns (plain Django views, Pydantic schemas, no DRF)
   - **Completeness**: No TODO/FIXME left unaddressed, no debug prints, no commented-out code
   - **Tests**: Are new code paths covered by tests? Are existing tests updated for changed behavior?
   - **Consistency**: Import ordering, naming conventions, file organization match the codebase

3. Classify each finding as:
   - **BLOCKER** — Must fix before commit (bugs, security issues, broken logic, missing tests for new code)
   - **WARNING** — Should fix but not a dealbreaker (style nits, minor improvements)
   - **NOTE** — Informational, no action needed

4. Present the review summary to the user.

5. **GATE**: If there are ANY blocker findings:
   - List every blocker clearly with file path and line number
   - Do NOT proceed to Step 2
   - Do NOT commit or push
   - Stop here and tell the user what needs to be fixed

   If there are only warnings/notes or no findings, continue to Step 2.

## Step 2: Run Lint

```bash
export PATH="$HOME/.local/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH" && uv run ruff check backend/
```

- If lint fails, fix the issues automatically, re-run to confirm, and include the fixes in the commit.
- If lint issues cannot be auto-fixed, treat as a **BLOCKER** — stop and report.

## Step 3: Run Tests

```bash
export PATH="$HOME/.local/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH" && uv run pytest -v
```

- If any test fails, **stop and report**. Do NOT commit with failing tests.

## Step 4: Commit

Only reach this step if: review passed (no blockers), lint passed, tests passed.

1. Stage only the relevant changed files (never use `git add -A` blindly — exclude `.env`, credentials, large binaries)
2. If `$ARGUMENTS` is provided, use it as the commit message
3. If no arguments, draft a concise commit message based on the changes:
   - Summarize the "why" not the "what"
   - Use conventional commit style (feat/fix/refactor/docs/test/chore)
4. Always append `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
5. Use a HEREDOC for the commit message

## Step 5: Push

```bash
git push origin $(git branch --show-current)
```

Report the final commit hash and branch name.
