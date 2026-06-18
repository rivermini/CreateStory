#!/bin/bash
set -e

# Ensure output directory exists and is writable by appuser.
# Named volumes can preserve root-owned files between container recreations,
# which breaks runtime writes to per-session subdirs like
# /app/output/auto_audio_logs/{session_id}/. Recursively fixing the
# directory mode (and chown when we have CAP_CHOWN) keeps auto-audio
# sessions working across container restarts.
mkdir -p /app/output
mkdir -p /app/output/auto_audio_logs

# chown requires CAP_CHOWN — try it, but ignore failures on restricted hosts.
chown -R appuser:appuser /app/output 2>/dev/null || \
    chmod -R 777 /app/output 2>/dev/null || true

# Drop privileges and exec the command as appuser.
if command -v gosu >/dev/null 2>&1; then
    exec gosu appuser "$@"
elif command -v su-exec >/dev/null 2>&1; then
    exec su-exec appuser "$@"
else
    # Fallback: run as the current user (the Dockerfile already sets USER appuser).
    exec "$@"
fi
