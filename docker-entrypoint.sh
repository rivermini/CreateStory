#!/bin/bash
set -e

# Ensure output directory exists and is owned by appuser.
# This is required for auto-audio mode which writes per-batch subdirs to
# /app/output/bedread/{batch_id}/ at runtime. Named volumes preserve files
# between container recreations, so the volume can be re-mounted with files
# owned by root from a previous build. Force-rewriting ownership at every
# startup makes auto-audio reliable across restarts.
mkdir -p /app/output
mkdir -p /app/output/bedread
mkdir -p /app/output/tts
mkdir -p /app/output/auto_audio_logs

chown -R appuser:appuser /app/output

exec "$@"
