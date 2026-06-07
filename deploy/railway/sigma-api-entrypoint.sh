#!/bin/sh
set -eu

data_dir="${DB_PATH:-/data/sigma.db}"
data_dir="$(dirname "$data_dir")"
sandbox_dir="${SIGMA_SANDBOX_PATH:-/data/sandbox}"

mkdir -p "$data_dir" "$sandbox_dir"
chown -R node:node "$data_dir" "$sandbox_dir" 2>/dev/null || true

exec gosu node "$@"
