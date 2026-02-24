---
description: AI-assisted workflow to detect, assess, and selectively apply upstream OpenClaw changes to Athena
---

# Upstream Change Review Workflow

Use this workflow to detect new changes in the upstream OpenClaw repository,
assess which ones are relevant or safe for Athena, and selectively apply them.

## Quick Reference

```bash
# Fetch upstream and generate a categorized change report
./scripts/upstream-review.sh

# Save the report to docs/sonance/upstream-reviews/
./scripts/upstream-review.sh --save

# Filter to a specific category
./scripts/upstream-review.sh --category tools

# Changes since a specific date
./scripts/upstream-review.sh --since 2026-02-01
```

---

## When to Run This Workflow

- **Weekly cadence** — run `./scripts/upstream-review.sh` at least weekly to
  stay aware of upstream changes.
- **Before any Athena release** — ensure you've assessed recent upstream changes
  for security patches or critical fixes.
- **When a user reports a bug** — check if upstream has already fixed it.

---

## Step 1: Detect Changes

```bash
git fetch upstream
./scripts/upstream-review.sh --save
```

This produces a report categorized by area (tools, security, config, plugins,
etc.) with:

- Upstream commits you're missing
- Changed files grouped by category and risk level
- Conflicts with Sonance-modified files
- New tools that need security review
- Recommended actions

## Step 2: AI-Assisted Triage

When asked to review upstream changes, follow this triage process:

### Priority 1: Security & Tool Policy (must review immediately)

```bash
# Show the exact diff for security-related changes
git diff HEAD...upstream/main -- src/security/ src/agents/tool-policy*.ts src/agents/pi-tools.policy.ts
```

**Questions to answer:**

- Are there new security patches we need?
- Have tool policy enforcement rules changed?
- Are there new dangerous tool classifications?
- Has the auth system been modified?

**Action:** Security fixes should almost always be applied. Tool policy changes
need careful review against our Sonance profile.

### Priority 2: Config Schema & Plugin API (review before next release)

```bash
git diff HEAD...upstream/main -- src/config/ src/plugins/
```

**Questions to answer:**

- Has the config schema added new required fields?
- Has the plugin API (`registerTool`, `registerService`) changed signatures?
- Will our Cortex plugin still compile/work?

**Action:** Schema changes may break our config. Plugin API changes may break
the Cortex extension. Test before applying.

### Priority 3: Gateway & Core Runtime (review selectively)

```bash
git diff HEAD...upstream/main -- src/gateway/ src/agents/
```

**Questions to answer:**

- Are there performance improvements we want?
- Bug fixes relevant to our usage?
- New features that would benefit Sonance users?

**Action:** Cherry-pick specific commits for bug fixes. Evaluate features
individually.

### Priority 4: Everything Else (low priority)

Channels, docs, UI, tests — these rarely affect Athena since we deny most
channel plugins and have our own UI flow.

---

## Step 3: Selective Cherry-Pick

For each change you want to apply:

### Option A: Cherry-pick a specific commit

```bash
# Preview the commit
git show <commit-hash> --stat
git show <commit-hash>

# Apply it
git cherry-pick <commit-hash>

# If there are conflicts, resolve them
git status
# ... fix conflicts ...
git add <resolved-files>
git cherry-pick --continue
```

### Option B: Apply a specific file's changes

```bash
# See what changed in a specific file
git diff HEAD...upstream/main -- path/to/file.ts

# Apply just that file's changes (creates unstaged changes)
git checkout upstream/main -- path/to/file.ts

# Review and selectively stage
git diff path/to/file.ts
git add -p path/to/file.ts    # interactive staging
git checkout -- path/to/file.ts  # revert what you don't want
```

### Option C: Apply changes from a range of commits

```bash
# Cherry-pick a range (oldest..newest, exclusive of oldest)
git cherry-pick <oldest-commit>^..<newest-commit>
```

---

## Step 4: Post-Merge Verification

After applying any upstream changes:

```bash
# 1. Verify tool whitelist is intact
bun scripts/tool-audit.ts

# 2. Verify Sonance defaults still apply
grep -n "SONANCE_DEFAULT_TOOL_PROFILE" src/agents/pi-tools.policy.ts

# 3. Type check
pnpm build

# 4. Run tests (especially profile-related ones)
pnpm test -- --grep "sonance\|tool.?policy\|whitelist"

# 5. Full test suite
pnpm test

# 6. Update SONANCE_FORK.md if any Sonance-modified files were affected
# Review the "Modified Core Files" table and update as needed
```

---

## Step 5: Document the Review

If `--save` was used, the report is at `docs/sonance/upstream-reviews/<date>.md`.
Annotate it with your decisions:

```markdown
## Review Decisions — YYYY-MM-DD

### Applied

- <commit> — <reason>

### Skipped

- <commit> — <reason for skipping>

### Deferred

- <commit> — <needs more investigation, will revisit>
```

---

## AI Agent Instructions

When the user asks you to "check for upstream updates" or "review upstream
changes", follow this exact sequence:

1. Run `git fetch upstream` and `./scripts/upstream-review.sh`
2. Read the report output carefully
3. For each HIGH-risk category with changes, read the actual diffs:
   ```bash
   git diff HEAD...upstream/main -- <category-paths>
   ```
4. Summarize findings in plain language:
   - What changed and why (read commit messages)
   - What's relevant to Athena
   - What should be applied vs skipped
   - What conflicts exist with Sonance-modified files
5. Propose specific cherry-pick commands for approved changes
6. After applying, run the verification checklist from Step 4

**Never blindly merge or rebase** — always review categorized changes and get
approval before applying.

---

## Conflict Resolution Guide

When upstream changes conflict with Sonance modifications (listed in
`SONANCE_FORK.md`), use this guide:

| File                              | Resolution Strategy                                                 |
| --------------------------------- | ------------------------------------------------------------------- |
| `src/agents/tool-policy.ts`       | Keep Sonance profile/groups, merge new upstream tool groups/aliases |
| `src/agents/pi-tools.policy.ts`   | Keep `SONANCE_DEFAULT_TOOL_PROFILE`, merge structural changes       |
| `src/config/types.tools.ts`       | Keep `"sonance"` in `ToolProfileId`, merge new config types         |
| `src/config/zod-schema.ts`        | Keep `"sonance-sso"` additions, merge new schema entries            |
| `src/config/io.ts`                | Keep `applySonanceDefaults()` call, merge other changes             |
| `src/agents/model-auth.ts`        | Keep central key resolver hook, merge auth flow changes             |
| `src/commands/models/auth.ts`     | Keep self-service auth guard, merge new auth commands               |
| `src/gateway/auth.ts`             | Keep `"sonance-sso"` mode, merge new auth modes                     |
| `src/security/dangerous-tools.ts` | Keep expanded deny lists, merge new entries                         |
| `package.json`                    | Take upstream deps, keep Athena metadata (name, repo URL)           |
| `pnpm-lock.yaml`                  | Accept upstream, regenerate with `pnpm install`                     |

---

## Automation: Scheduled Check (Optional)

To receive periodic notifications about upstream changes, add a cron job
or GitHub Action:

```yaml
# .github/workflows/upstream-check.yml
name: Check Upstream Changes
on:
  schedule:
    - cron: "0 9 * * 1" # Every Monday at 9am
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: git remote add upstream https://github.com/openclaw/openclaw.git
      - run: git fetch upstream main
      - run: |
          BEHIND=$(git rev-list --count HEAD..upstream/main)
          echo "Athena is $BEHIND commits behind upstream."
          if [ "$BEHIND" -gt 0 ]; then
            echo "::warning::Athena is $BEHIND commits behind upstream OpenClaw. Run ./scripts/upstream-review.sh"
          fi
```
