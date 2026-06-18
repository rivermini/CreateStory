#!/bin/bash
set -e

# Ensure output directory exists and is owned by appuser.
# Named volumes can preserve root-owned files between container recreations,
# which breaks runtime writes to per-session subdirs like
# /app/output/auto_audio_logs/{session_id}/. Force-rewriting ownership at
# every startup makes auto-audio sessions reliable across restarts.
mkdir -p /app/output
mkdir -p /app/output/auto_audio_logs

chown -R appuser:appuser /app/output

exec "$@"
