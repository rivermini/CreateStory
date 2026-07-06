#!/bin/bash
set -e

mkdir -p /app/output
chown -R appuser:appuser /app/output 2>/dev/null || \
    chmod -R u+rwX,g+rwX /app/output 2>/dev/null || true

exec gosu appuser "$@"
