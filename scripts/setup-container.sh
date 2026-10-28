#!/bin/bash
# One-time setup for a Claude Code web environment. Point the environment's setup script at
# this file. It installs what the container lacks and this project needs: a local Postgres for
# `npm run test:sql`, which replays every migration from zero into a scratch database on it, the
# same discipline as the Postgres service in .github/workflows/sql.yml.
#
# Idempotent: safe to run again. Prints the DATABASE_URL to set on the environment; a setup
# script cannot export variables into later sessions, so that step is by hand.
#
# Carried from currents (docs/plans/port-manifest.md), with its OCR packages left behind.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
sudo_or_plain() { if command -v sudo >/dev/null 2>&1; then sudo "$@"; else "$@"; fi; }

if ! command -v pg_lsclusters >/dev/null 2>&1; then
  sudo_or_plain apt-get update -qq
  sudo_or_plain apt-get install -y -qq postgresql postgresql-contrib
fi

# Start the cluster the package created and give the default superuser a known password. The
# statement lives in one script, which the session-start hook runs too.
sudo_or_plain service postgresql start
bash "$(dirname "$0")/local-postgres-password.sh"

echo "setup-container: done"
echo "Set on the environment: DATABASE_URL=postgres://postgres:pg@localhost:5432/postgres"
echo "Note: the packaged Postgres is the distribution's default major version; CI runs Postgres 17, as Supabase does."
