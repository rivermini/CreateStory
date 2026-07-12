#!/bin/sh
set -eu

MODE="${BACKUP_MODE:-backup}"
ROOT=/backups/service-databases
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

read_secret() {
    tr -d '\r\n' < "/run/secrets/$1"
}

normalize_url() {
    printf '%s' "$1" | sed 's#^postgresql+psycopg://#postgresql://#'
}

GATEWAY_URL="$(normalize_url "$(read_secret gateway_database_url)")"
CRAWLER_URL="$(normalize_url "$(read_secret crawler_database_url)")"
VOICES_URL="$(normalize_url "$(read_secret voices_database_url)")"
DRIVE_SYNC_URL="$(normalize_url "$(read_secret drive_sync_database_url)")"
AUTO_AUDIO_URL="$(normalize_url "$(read_secret auto_audio_database_url)")"

validate_set_name() {
    case "$1" in
        ''|*[!A-Za-z0-9_.-]*)
            echo "[database-backup] invalid backup set name: $1" >&2
            exit 2
            ;;
    esac
}

verify_set() {
    set_name="$1"
    validate_set_name "$set_name"
    set_dir="$ROOT/$set_name"
    test -d "$set_dir" || {
        echo "[database-backup] backup set not found: $set_name" >&2
        exit 1
    }
    test -f "$set_dir/COMPLETE" || {
        echo "[database-backup] backup set is incomplete: $set_name" >&2
        exit 1
    }
    (cd "$set_dir" && sha256sum -c SHA256SUMS)
    for database in gateway crawler voices drive_sync auto_audio; do
        pg_restore --list "$set_dir/${database}.dump" >/dev/null
    done
    echo "[database-backup] verified: $set_name"
}

dump_database() {
    label="$1"
    url="$2"
    destination="$3"
    echo "[database-backup] dumping $label"
    pg_dump "$url" \
        --format=custom \
        --compress=6 \
        --no-owner \
        --no-privileges \
        --file="$destination/$label.dump"
    pg_restore --list "$destination/$label.dump" >/dev/null
}

backup_all() {
    mkdir -p "$ROOT"
    set_name="${BACKUP_SET:-$(date -u +%Y%m%dT%H%M%SZ)}"
    validate_set_name "$set_name"
    final_dir="$ROOT/$set_name"
    partial_dir="$ROOT/.${set_name}.partial"
    test ! -e "$final_dir" || {
        echo "[database-backup] backup set already exists: $set_name" >&2
        exit 1
    }
    rm -rf "$partial_dir"
    mkdir -p "$partial_dir"
    trap 'rm -rf "$partial_dir"' EXIT INT TERM

    dump_database gateway "$GATEWAY_URL" "$partial_dir"
    dump_database crawler "$CRAWLER_URL" "$partial_dir"
    dump_database voices "$VOICES_URL" "$partial_dir"
    dump_database drive_sync "$DRIVE_SYNC_URL" "$partial_dir"
    dump_database auto_audio "$AUTO_AUDIO_URL" "$partial_dir"

    (
        cd "$partial_dir"
        sha256sum gateway.dump crawler.dump voices.dump drive_sync.dump auto_audio.dump > SHA256SUMS
        printf 'created_utc=%s\npostgres_version=%s\n' \
            "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(pg_dump --version)" > MANIFEST
        touch COMPLETE
    )
    mv "$partial_dir" "$final_dir"
    trap - EXIT INT TERM

    verify_set "$set_name"

    case "$RETENTION_DAYS" in
        ''|*[!0-9]*)
            echo "[database-backup] BACKUP_RETENTION_DAYS must be a non-negative integer" >&2
            exit 2
            ;;
    esac
    find "$ROOT" -mindepth 1 -maxdepth 1 -type d \
        -name '20??????T??????Z' -mtime "+$RETENTION_DAYS" -exec rm -rf '{}' ';'
    echo "[database-backup] complete: $set_name"
}

restore_all() {
    set_name="${BACKUP_SET:-}"
    verify_set "$set_name"
    set_dir="$ROOT/$set_name"
    admin_password="$(read_secret postgres_password)"

    for spec in \
        'create_story_gateway:create_story_gateway' \
        'create_story_crawler:create_story_crawler' \
        'create_story_voices:create_story_voices' \
        'create_story_drive_sync:create_story_drive_sync' \
        'create_story_auto_audio:create_story_auto_audio'; do
        database="${spec%%:*}"
        owner="${spec##*:}"
        echo "[database-backup] recreating $database"
        PGPASSWORD="$admin_password" psql -v ON_ERROR_STOP=1 \
            -h postgres -U create_story -d postgres \
            -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE);" \
            -c "CREATE DATABASE \"$database\" OWNER \"$owner\";" \
            -c "REVOKE ALL ON DATABASE \"$database\" FROM PUBLIC;" \
            -c "GRANT CONNECT ON DATABASE \"$database\" TO \"$owner\";"
        PGPASSWORD="$admin_password" psql -v ON_ERROR_STOP=1 \
            -h postgres -U create_story -d "$database" \
            -c "REVOKE ALL ON SCHEMA public FROM PUBLIC;" \
            -c "ALTER SCHEMA public OWNER TO \"$owner\";" \
            -c "GRANT ALL ON SCHEMA public TO \"$owner\";"
    done

    pg_restore --exit-on-error --no-owner --no-privileges --dbname="$GATEWAY_URL" "$set_dir/gateway.dump"
    pg_restore --exit-on-error --no-owner --no-privileges --dbname="$CRAWLER_URL" "$set_dir/crawler.dump"
    pg_restore --exit-on-error --no-owner --no-privileges --dbname="$VOICES_URL" "$set_dir/voices.dump"
    pg_restore --exit-on-error --no-owner --no-privileges --dbname="$DRIVE_SYNC_URL" "$set_dir/drive_sync.dump"
    pg_restore --exit-on-error --no-owner --no-privileges --dbname="$AUTO_AUDIO_URL" "$set_dir/auto_audio.dump"
    echo "[database-backup] restore complete: $set_name"
}

case "$MODE" in
    backup) backup_all ;;
    verify) verify_set "${BACKUP_SET:-}" ;;
    restore) restore_all ;;
    *)
        echo "[database-backup] invalid BACKUP_MODE=$MODE (backup|verify|restore)" >&2
        exit 2
        ;;
esac
