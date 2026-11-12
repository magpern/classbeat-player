#!/usr/bin/env bash
# Checks that a pull request title is Conventional Commits 1.0.0:
#   type(scope)!: subject
# Usage: check-pr-title.sh "<title>"
set -euo pipefail

title="${1-}"
re='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: [^ ].*$'

if [[ "$title" =~ $re ]]; then
  echo "pr-title: ok"
else
  echo "pr-title: not a Conventional Commits 1.0.0 title: '$title'" >&2
  echo "expected: type(scope)!: subject, type one of feat fix docs style refactor perf test build ci chore revert" >&2
  exit 1
fi
