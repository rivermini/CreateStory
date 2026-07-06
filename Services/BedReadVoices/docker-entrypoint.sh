#!/bin/bash
set -e

# Ensure output directory exists and is writable by appuser.
# This is required for auto-audio mode which writes per-batch subdirs to
# /app/output/bedread/{batch_id}/ at runtime. Named volumes preserve files
# between container recreations, so the volume can be re-mounted with files
# owned by root from a previous build. Recursively fixing the directory mode
# (and chown when we have CAP_CHOWN) keeps auto-audio working across restarts.
mkdir -p /app/output
mkdir -p /app/output/bedread
mkdir -p /app/output/tts
mkdir -p /app/output/auto_audio_logs

# chown requires CAP_CHOWN — try it, but ignore failures on restricted hosts.
chown -R appuser:appuser /app/output 2>/dev/null || \
    chmod -R u+rwX,g+rwX /app/output 2>/dev/null || true

# Drop privileges and exec the command as appuser.
if command -v gosu >/dev/null 2>&1; then
    exec gosu appuser "$@"
elif command -v su-exec >/dev/null 2>&1; then
    exec su-exec appuser "$@"
else
    # Fallback: run as the current user (the Dockerfile already sets USER appuser).
    exec "$@"
fi
