#!/bin/bash
# Give the local cluster's default superuser the password every DATABASE_URL in this
# repository names: postgres://postgres:pg@localhost:5432/postgres.
#
# One statement in one place, run by scripts/setup-container.sh once per environment and by
# .claude/hooks/session-start.sh on every session start. The hook runs it too because a
# container can arrive with Postgres installed and the setup script never run, and a hook that
# printed the URL as a fact without setting the password sent every session to its first
# test:sql to find out otherwise. Two copies of the statement would drift, so both call this.
# Carried from currents (docs/plans/port-manifest.md).
#
# The local cluster only: psql as the postgres OS user over the local socket, never a host.
# Idempotent, so running it on every start costs nothing.
set -uo pipefail

stmt="ALTER USER postgres PASSWORD 'pg';"
if command -v sudo >/dev/null 2>&1 && sudo -u postgres psql -v ON_ERROR_STOP=1 -qtAc "$stmt" >/dev/null 2>&1; then
  exit 0
fi
su postgres -c "psql -v ON_ERROR_STOP=1 -qtAc \"$stmt\"" >/dev/null 2>&1
