#!/usr/bin/env bash
# Manage per-issue worktrees under ../classbeat-player-wt/.
#   worktree.sh new <issue> <slug>   branch <issue>-<slug> from origin/main
#   worktree.sh ls
#   worktree.sh rm <issue>
set -euo pipefail

usage() {
  echo "usage: $0 new <issue> <slug> | ls | rm <issue>" >&2
  exit 2
}

root="$(git rev-parse --show-toplevel)"
wt_base="$root/../classbeat-player-wt"

cmd="${1-}"
[ -n "$cmd" ] || usage

case "$cmd" in
  new)
    issue="${2-}"
    slug="${3-}"
    [ -n "$issue" ] && [ -n "$slug" ] || usage
    [[ "$issue" =~ ^[0-9]+$ ]] || { echo "issue must be a number" >&2; exit 2; }
    [[ "$slug" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "slug must be lowercase letters, digits and dashes" >&2; exit 2; }
    branch="$issue-$slug"
    dir="$wt_base/$branch"
    git -C "$root" fetch origin main
    mkdir -p "$wt_base"
    git -C "$root" worktree add -b "$branch" "$dir" origin/main
    offset=$(( (10#$issue % 100) * 10 ))
    if [ -f "$dir/.env.example" ]; then
      cp "$dir/.env.example" "$dir/.env"
    else
      : >"$dir/.env"
    fi
    printf 'PORT_OFFSET=%s\n' "$offset" >>"$dir/.env"
    echo "worktree: $dir (branch $branch, PORT_OFFSET=$offset)"
    ;;
  ls)
    git -C "$root" worktree list
    ;;
  rm)
    issue="${2-}"
    [ -n "$issue" ] || usage
    [[ "$issue" =~ ^[0-9]+$ ]] || { echo "issue must be a number" >&2; exit 2; }
    found=0
    for dir in "$wt_base/$issue"-*; do
      [ -d "$dir" ] || continue
      found=1
      branch="$(git -C "$dir" symbolic-ref --short -q HEAD || true)"
      git -C "$root" worktree remove --force "$dir"
      echo "removed $dir"
      [ -n "$branch" ] || continue
      # Delete the branch only when origin/main already contains it (merged, or no commits
      # of its own); otherwise keep it, because it may hold unmerged work.
      if git -C "$root" merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
        git -C "$root" branch -D "$branch" >/dev/null
        echo "deleted branch $branch (merged or no commits of its own)"
      else
        echo "kept branch $branch: not contained in origin/main"
      fi
    done
    [ "$found" -eq 1 ] || { echo "no worktree for issue $issue" >&2; exit 1; }
    ;;
  *)
    usage
    ;;
esac
