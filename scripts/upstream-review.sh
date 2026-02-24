#!/usr/bin/env bash
set -euo pipefail

# ══════════════════════════════════════════════════════════════════════════════
# Athena Upstream Change Detector
#
# Fetches the latest changes from the upstream OpenClaw repo, compares them
# against the current Athena branch, and produces a categorized report that
# an AI agent (or human) can use to decide which changes to cherry-pick.
#
# Usage:
#   ./scripts/upstream-review.sh                    # full report
#   ./scripts/upstream-review.sh --since 2026-02-01 # changes since date
#   ./scripts/upstream-review.sh --files-only       # just list changed files
#   ./scripts/upstream-review.sh --category tools   # filter by category
#   ./scripts/upstream-review.sh --save             # save report to file
# ══════════════════════════════════════════════════════════════════════════════

UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
LOCAL_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REPORT_DIR="docs/sonance/upstream-reviews"

# ── Parse arguments ──────────────────────────────────────────────────────────
SINCE=""
FILES_ONLY=false
CATEGORY_FILTER=""
SAVE_REPORT=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --since) SINCE="$2"; shift 2 ;;
    --files-only) FILES_ONLY=true; shift ;;
    --category) CATEGORY_FILTER="$2"; shift 2 ;;
    --save) SAVE_REPORT=true; shift ;;
    --help|-h)
      echo "Usage: upstream-review.sh [--since DATE] [--files-only] [--category CATEGORY] [--save]"
      echo ""
      echo "Categories: tools, security, config, plugins, gateway, ui, tests, docs, infra, other"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Ensure upstream remote exists ────────────────────────────────────────────
if ! git remote get-url "$UPSTREAM_REMOTE" &>/dev/null; then
  echo "Adding upstream remote..."
  git remote add "$UPSTREAM_REMOTE" https://github.com/openclaw/openclaw.git
fi

# ── Fetch upstream ───────────────────────────────────────────────────────────
echo "==> Fetching upstream ($UPSTREAM_REMOTE/$UPSTREAM_BRANCH)..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --quiet

# ── Find divergence point ────────────────────────────────────────────────────
MERGE_BASE=$(git merge-base HEAD "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || echo "")
if [[ -z "$MERGE_BASE" ]]; then
  echo "ERROR: No common ancestor found between $LOCAL_BRANCH and $UPSTREAM_REMOTE/$UPSTREAM_BRANCH."
  echo "This could mean the repositories have unrelated histories."
  exit 1
fi

# ── Count divergence ─────────────────────────────────────────────────────────
AHEAD=$(git rev-list --count "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH..HEAD")
BEHIND=$(git rev-list --count "HEAD..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH")

# ── Build the commit range ───────────────────────────────────────────────────
RANGE="HEAD..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
if [[ -n "$SINCE" ]]; then
  RANGE_OPTS="--since=$SINCE"
else
  RANGE_OPTS=""
fi

# ── Categorize files ─────────────────────────────────────────────────────────
categorize_file() {
  local file="$1"
  case "$file" in
    src/agents/tool*|src/agents/pi-tools*|src/agents/tools/*)
      echo "tools" ;;
    src/security/*|src/gateway/auth*|src/gateway/sonance*)
      echo "security" ;;
    src/config/*)
      echo "config" ;;
    src/plugins/*|extensions/*)
      echo "plugins" ;;
    src/gateway/*)
      echo "gateway" ;;
    src/tui/*|src/web/*|src/canvas*|apps/*)
      echo "ui" ;;
    src/cli/*|src/commands/*)
      echo "cli" ;;
    *.test.ts|test/*)
      echo "tests" ;;
    docs/*)
      echo "docs" ;;
    src/infra/*|scripts/*|.github/*)
      echo "infra" ;;
    src/channels/*|src/telegram/*|src/discord/*|src/slack/*|src/signal/*|src/imessage/*|src/routing/*)
      echo "channels" ;;
    package.json|pnpm-lock.yaml|patches/*)
      echo "deps" ;;
    *)
      echo "other" ;;
  esac
}

# Risk-assess a category for Sonance fork concerns
risk_for_category() {
  local cat="$1"
  case "$cat" in
    tools)    echo "HIGH   — may affect tool whitelist or policy enforcement" ;;
    security) echo "HIGH   — may affect auth, audit, or access control" ;;
    config)   echo "MEDIUM — may affect config schema or defaults" ;;
    plugins)  echo "MEDIUM — may affect plugin API or Cortex integration" ;;
    gateway)  echo "MEDIUM — may affect gateway auth or WebSocket handling" ;;
    channels) echo "LOW    — Sonance denies all channel plugins" ;;
    deps)     echo "MEDIUM — dependency updates may introduce vulnerabilities" ;;
    tests)    echo "LOW    — test changes rarely affect production" ;;
    docs)     echo "LOW    — documentation updates" ;;
    *)        echo "LOW    — general changes" ;;
  esac
}

# ── Generate report ──────────────────────────────────────────────────────────
generate_report() {
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  Athena Upstream Change Report"
  echo "  Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "═══════════════════════════════════════════════════════════════════"
  echo ""
  echo "  Local branch:    $LOCAL_BRANCH"
  echo "  Upstream:        $UPSTREAM_REMOTE/$UPSTREAM_BRANCH"
  echo "  Merge base:      ${MERGE_BASE:0:12}"
  echo "  Athena ahead:    $AHEAD commits"
  echo "  Athena behind:   $BEHIND commits"
  if [[ -n "$SINCE" ]]; then
    echo "  Since:           $SINCE"
  fi
  echo ""

  if [[ "$BEHIND" -eq 0 ]]; then
    echo "  ✓ Athena is up to date with upstream."
    echo ""
    return
  fi

  # ── Upstream commits ──────────────────────────────────────────────────────
  echo "───────────────────────────────────────────────────────────────────"
  echo "  UPSTREAM COMMITS ($BEHIND new)"
  echo "───────────────────────────────────────────────────────────────────"
  echo ""

  # shellcheck disable=SC2086
  git log $RANGE_OPTS --oneline --no-merges "$RANGE" | while IFS= read -r line; do
    echo "  $line"
  done
  echo ""

  # ── Changed files by category ──────────────────────────────────────────────
  echo "───────────────────────────────────────────────────────────────────"
  echo "  CHANGED FILES BY CATEGORY"
  echo "───────────────────────────────────────────────────────────────────"
  echo ""

  # Get all changed files
  local changed_files
  changed_files=$(git diff --name-only "$MERGE_BASE" "$UPSTREAM_REMOTE/$UPSTREAM_BRANCH" 2>/dev/null || true)

  if [[ -z "$changed_files" ]]; then
    echo "  No file changes detected."
    return
  fi

  if $FILES_ONLY; then
    echo "$changed_files" | sort
    return
  fi

  # Group by category using temp files (compatible with bash 3 / macOS)
  local tmpdir
  tmpdir=$(mktemp -d)
  trap "rm -rf '$tmpdir'" RETURN

  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    local cat
    cat=$(categorize_file "$file")

    if [[ -n "$CATEGORY_FILTER" && "$cat" != "$CATEGORY_FILTER" ]]; then
      continue
    fi

    echo "$file" >> "$tmpdir/$cat"
  done <<< "$changed_files"

  # Display categories in risk order (high-risk first)
  local risk_order="tools security config plugins gateway cli channels deps ui tests docs infra other"
  for cat in $risk_order; do
    if [[ -f "$tmpdir/$cat" ]]; then
      local count
      count=$(wc -l < "$tmpdir/$cat" | tr -d ' ')
      local risk
      risk=$(risk_for_category "$cat")
      local cat_upper
      cat_upper=$(echo "$cat" | tr '[:lower:]' '[:upper:]')
      echo "  ┌─ $cat_upper ($count files) — $risk"
      while IFS= read -r f; do
        [[ -z "$f" ]] && continue
        echo "  │  $f"
      done < "$tmpdir/$cat"
      echo "  └─"
      echo ""
    fi
  done

  # ── Sonance-sensitive changes ─────────────────────────────────────────────
  echo "───────────────────────────────────────────────────────────────────"
  echo "  SONANCE FORK IMPACT ANALYSIS"
  echo "───────────────────────────────────────────────────────────────────"
  echo ""

  local sonance_files
  sonance_files=$(cat SONANCE_FORK.md 2>/dev/null | grep -E '^\| `' | sed 's/| `//;s/`.*//' | tr -d ' ' || true)

  local conflicts=0
  if [[ -n "$sonance_files" ]]; then
    while IFS= read -r sf; do
      [[ -z "$sf" ]] && continue
      if echo "$changed_files" | grep -qF "$sf"; then
        echo "  ⚠ CONFLICT: $sf (modified by both Athena and upstream)"
        conflicts=$((conflicts + 1))
      fi
    done <<< "$sonance_files"
  fi

  if [[ $conflicts -eq 0 ]]; then
    echo "  ✓ No direct conflicts with Sonance-modified files."
  else
    echo ""
    echo "  ⚠ $conflicts file(s) modified by both Athena and upstream."
    echo "    These will need manual conflict resolution during merge/rebase."
  fi
  echo ""

  # ── Tool policy changes ──────────────────────────────────────────────────
  local tool_changes
  tool_changes=$(echo "$changed_files" | grep -E '(tool-policy|pi-tools\.policy|dangerous-tools|tool-policy-shared)' || true)
  if [[ -n "$tool_changes" ]]; then
    echo "  🔒 TOOL POLICY CHANGES DETECTED:"
    echo "$tool_changes" | while IFS= read -r f; do
      echo "     $f"
    done
    echo "     → Review these carefully: may affect Sonance whitelist enforcement."
    echo ""
  fi

  # ── New tools ────────────────────────────────────────────────────────────
  local new_tools
  new_tools=$(echo "$changed_files" | grep -E '^src/agents/tools/.*-tool\.ts$' || true)
  if [[ -n "$new_tools" ]]; then
    local existing_tools
    existing_tools=$(git ls-tree --name-only HEAD -- src/agents/tools/ 2>/dev/null || true)
    echo "  🆕 TOOL FILES CHANGED:"
    echo "$new_tools" | while IFS= read -r f; do
      if echo "$existing_tools" | grep -qF "$(basename "$f")"; then
        echo "     MODIFIED: $f"
      else
        echo "     NEW:      $f  ← needs security review before allowing"
      fi
    done
    echo ""
  fi

  # ── Recommendations ──────────────────────────────────────────────────────
  echo "───────────────────────────────────────────────────────────────────"
  echo "  RECOMMENDED ACTIONS"
  echo "───────────────────────────────────────────────────────────────────"
  echo ""

  if [[ -n "$tool_changes" ]]; then
    echo "  1. REVIEW tool policy changes before merging."
    echo "     Run: git diff $MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH -- src/agents/tool-policy.ts"
    echo ""
  fi

  if [[ $conflicts -gt 0 ]]; then
    echo "  2. RESOLVE Sonance-modified file conflicts manually."
    echo "     Reference: SONANCE_FORK.md for intent of each Athena modification."
    echo ""
  fi

  echo "  To cherry-pick specific commits:"
  echo "    git cherry-pick <commit-hash>"
  echo ""
  echo "  To see the full diff for a category:"
  echo "    git diff $MERGE_BASE..$UPSTREAM_REMOTE/$UPSTREAM_BRANCH -- <path>"
  echo ""
  echo "  To run the AI-assisted review workflow:"
  echo "    See .agent/workflows/upstream-change-review.md"
  echo ""
}

# ── Output ───────────────────────────────────────────────────────────────────
if $SAVE_REPORT; then
  mkdir -p "$REPORT_DIR"
  REPORT_FILE="$REPORT_DIR/$(date '+%Y-%m-%d').md"
  {
    echo '```'
    generate_report
    echo '```'
  } > "$REPORT_FILE"
  echo "Report saved to: $REPORT_FILE"
else
  generate_report
fi
