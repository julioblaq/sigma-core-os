#!/bin/sh
set -eu

sandbox_dir="${SIGMA_SANDBOX_PATH:-/tmp/sigma-sandbox}"

mkdir -p "$sandbox_dir"
chown -R node:node "$sandbox_dir" 2>/dev/null || true

if [ -n "${DB_PATH:-}" ]; then
  db_dir="$(dirname "$DB_PATH")"
  mkdir -p "$db_dir"
  chown -R node:node "$db_dir" 2>/dev/null || true
fi

exec gosu node "$@"
