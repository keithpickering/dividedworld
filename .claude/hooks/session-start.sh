#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# A remote session clones the repository fresh, with no node_modules. This installs once;
# the container caches the project directory after the hook completes, so later sessions
# in the same environment skip it. Web only: a local checkout manages its own install.
# `npm ci`, never `npm install`: `install` may rewrite the lockfile when the two drift and a
# session would start with a dirty tree it did not make; `ci` installs exactly the lock or
# fails.
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

# A container set up once and reclaimed comes back with the Postgres packages and a stopped
# server. Start it when it is installed; say so either way, so a session that needs test:sql
# reads the answer in the hook's own output. The password is set on every start
# (scripts/local-postgres-password.sh, the local cluster only, idempotent), because a container
# can arrive with Postgres installed and scripts/setup-container.sh never run, and the URL is
# tried before it is printed. The hook says which, and never fails the session over it.
if command -v pg_lsclusters >/dev/null 2>&1; then
  if pg_lsclusters --no-header 2>/dev/null | grep -q online; then
    echo "session-start: postgres is running"
  else
    (sudo service postgresql start 2>/dev/null || service postgresql start) >/dev/null && echo "session-start: postgres started"
  fi
  url="postgres://postgres:pg@localhost:5432/postgres"
  bash "$CLAUDE_PROJECT_DIR/scripts/local-postgres-password.sh" || true
  if psql "$url" -qtAc 'select 1' >/dev/null 2>&1; then
    echo "session-start: DATABASE_URL=$url (connects)"
  else
    echo "session-start: DATABASE_URL=$url does NOT connect, so test:sql will fail; run scripts/setup-container.sh"
  fi
else
  echo "session-start: postgres is not installed; run scripts/setup-container.sh once per environment"
fi
