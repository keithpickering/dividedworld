#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# A remote session clones the repository fresh, with no node_modules. This installs once;
# the container caches the project directory after the hook completes, so later sessions
# in the same environment skip it. Web only: a local checkout manages its own install.
# `npm ci`, never `npm install`: `install` may rewrite the lockfile when the two drift and a
# session would start with a dirty tree it did not make; `ci` installs exactly the lock or
# fails.
#
# The local Postgres half of currents' hook (start the server, set its password, say whether
# DATABASE_URL connects) comes with the first migration, when a session first needs it.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if [ ! -f package-lock.json ]; then
  echo "session-start: no package-lock.json yet, nothing to install"
  exit 0
fi

if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "session-start: installing dependencies (npm ci)"
  npm ci --no-audit --no-fund
else
  echo "session-start: node_modules is current, nothing to install"
fi
