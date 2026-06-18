#!/bin/bash
set -e

# Ensure output directory exists with proper permissions for named volumes.
# Suppress chown warnings on pre-existing root-owned files in the volume;
# new files/dirs created here will be owned by appuser.
mkdir -p /app/output
chown -R appuser:appuser /app/output 2>/dev/null || true

exec "$@"
