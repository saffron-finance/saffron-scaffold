#!/usr/bin/env bash
# Resolve the committed launcher from any checkout location.
set -euo pipefail
exec node "$(dirname "$0")/start.mjs" "$@"
