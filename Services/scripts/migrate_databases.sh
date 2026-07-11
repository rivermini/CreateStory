#!/bin/sh
set -eu

MODE="${MIGRATION_MODE:-plan}"

secret() {
    value="$(cat "/run/secrets/$1")"
    if [ -z "$value" ]; then
        echo "[database-migration] empty secret: $1" >&2
        exit 1
    fi
    printf '%s' "$value"
}

normalize_url() {
    printf '%s' "$1" | sed 's#^postgresql+psycopg://#postgresql://#'
}

LEGACY_URL="$(normalize_url "$(secret database_url)")"
POSTGRES_PASSWORD="$(secret postgres_password)"
export PGPASSWORD="$POSTGRES_PASSWORD"

admin_url() {
    printf 'postgresql://create_story@postgres:5432/%s' "$1"
}

target_url_secret() {
    case "$1" in
        create_story_gateway) normalize_url "$(secret gateway_database_url)" ;;
        create_story_crawler) normalize_url "$(secret crawler_database_url)" ;;
        create_story_voices) normalize_url "$(secret voices_database_url)" ;;
        create_story_drive_sync) normalize_url "$(secret drive_sync_database_url)" ;;
        create_story_auto_audio) normalize_url "$(secret auto_audio_database_url)" ;;
        *) echo "unknown target database: $1" >&2; exit 1 ;;
    esac
}

TARGET_DATABASES="
create_story_gateway
create_story_crawler
create_story_voices
create_story_drive_sync
create_story_auto_audio
"

# Ordered for foreign-key safety (users before refresh_tokens). app_settings is
# handled separately because the legacy user_settings document is split.
TABLE_ROUTES="
create_story_gateway:users
create_story_gateway:refresh_tokens
create_story_gateway:shared_json_documents
create_story_gateway:migration_audit
create_story_crawler:crawl_sessions
create_story_crawler:crawl_output_files
create_story_crawler:inkitt_cookies
create_story_crawler:scribblehub_cookies
create_story_crawler:goodnovel_cookies
create_story_crawler:webnovel_cookies
create_story_voices:bedread_audio_jobs
create_story_voices:generated_audio_files
create_story_drive_sync:drive_sync_status
create_story_drive_sync:drive_sync_history
create_story_drive_sync:drive_sync_jobs
create_story_drive_sync:cover_update_histories
create_story_drive_sync:banner_update_histories
create_story_drive_sync:intro_update_histories
create_story_drive_sync:external_credentials
create_story_auto_audio:auto_audio_sessions
create_story_auto_audio:auto_audio_completed_stories
"

GATEWAY_SETTINGS_QUERY="$(cat <<'SQL'
SELECT
    'user_settings'::varchar(128) AS key,
    value
      - ARRAY(
          SELECT setting_key
          FROM jsonb_object_keys(value) AS keys(setting_key)
          WHERE setting_key LIKE 'auto_audio_%'
        )
      - 'tts_concurrency' AS value,
    updated_at AS updated_at
FROM public.app_settings
WHERE key = 'user_settings'
SQL
)"

DRIVE_SETTINGS_QUERY="$(cat <<'SQL'
SELECT key, value, updated_at
FROM public.app_settings
WHERE key = 'drive_sync_config'
   OR key LIKE 'metadata_update_%_cache'
SQL
)"

AUTO_SETTINGS_QUERY="$(cat <<'SQL'
SELECT key, value, updated_at
FROM public.app_settings
WHERE key = 'auto_scan_state'
UNION ALL
SELECT
    'auto_audio_settings'::varchar(128) AS key,
    COALESCE(
        (SELECT value FROM public.app_settings WHERE key = 'auto_audio_settings'),
        (
            SELECT jsonb_object_agg(setting.key, setting.value)
            FROM public.app_settings source
            CROSS JOIN LATERAL jsonb_each(source.value) AS setting(key, value)
            WHERE source.key = 'user_settings' AND setting.key LIKE 'auto_audio_%'
        )
    ) AS value,
    COALESCE(
        (SELECT updated_at FROM public.app_settings WHERE key = 'auto_audio_settings'),
        (SELECT updated_at FROM public.app_settings WHERE key = 'user_settings'),
        CURRENT_TIMESTAMP
    ) AS updated_at
WHERE EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'auto_audio_settings')
   OR EXISTS (
       SELECT 1
       FROM public.app_settings source
       CROSS JOIN LATERAL jsonb_each(source.value) AS setting(key, value)
       WHERE source.key = 'user_settings' AND setting.key LIKE 'auto_audio_%'
   )
SQL
)"

VOICES_SETTINGS_QUERY="$(cat <<'SQL'
SELECT
    'tts_settings'::varchar(128) AS key,
    jsonb_build_object(
        'tts_concurrency',
        COALESCE(
            (SELECT value -> 'tts_concurrency' FROM public.app_settings WHERE key = 'tts_settings'),
            (SELECT value -> 'concurrency' FROM public.app_settings WHERE key = 'tts_settings'),
            (SELECT value -> 'tts_concurrency' FROM public.app_settings WHERE key = 'user_settings')
        )
    ) AS value,
    COALESCE(
        (SELECT updated_at FROM public.app_settings WHERE key = 'tts_settings'),
        (SELECT updated_at FROM public.app_settings WHERE key = 'user_settings'),
        CURRENT_TIMESTAMP
    ) AS updated_at
WHERE EXISTS (
       SELECT 1 FROM public.app_settings
       WHERE key = 'tts_settings'
         AND (value ? 'tts_concurrency' OR value ? 'concurrency')
   ) OR EXISTS (
       SELECT 1 FROM public.app_settings
       WHERE key = 'user_settings' AND value ? 'tts_concurrency'
   )
SQL
)"

table_exists() {
    url="$1"
    table="$2"
    [ "$(psql "$url" -X -Atqc "SELECT to_regclass('public.$table') IS NOT NULL")" = "t" ]
}

table_count() {
    psql "$1" -X -Atqc "SELECT count(*) FROM public.\"$2\""
}

find_common_columns() {
    source_table="$1"
    target_database="$2"
    target_table="$3"
    target_url="$(admin_url "$target_database")"

    source_columns="$(psql "$LEGACY_URL" -X -Atqc "
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '$source_table'
        ORDER BY ordinal_position")"
    target_columns="$(psql "$target_url" -X -Atqc "
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '$target_table'
        ORDER BY ordinal_position")"

    COMMON_COLUMNS=""
    while IFS= read -r column; do
        [ -n "$column" ] || continue
        if printf '%s\n' "$source_columns" | grep -Fqx -- "$column"; then
            if [ -n "$COMMON_COLUMNS" ]; then
                COMMON_COLUMNS="$COMMON_COLUMNS, \"$column\""
            else
                COMMON_COLUMNS="\"$column\""
            fi
        fi
    done <<EOF
$target_columns
EOF

    if [ -z "$COMMON_COLUMNS" ]; then
        echo "[database-migration] no common columns for $source_table -> $target_database.$target_table" >&2
        exit 1
    fi
}

copy_query() {
    target_database="$1"
    target_table="$2"
    columns="$3"
    query="$4"
    label="$5"
    target_url="$(admin_url "$target_database")"
    transfer_file="/tmp/create_story_${label}.bin"
    compact_query="$(printf '%s' "$query" | tr '\n' ' ')"

    echo "[database-migration] copying $label -> $target_database.$target_table"
    psql "$LEGACY_URL" -X --set=ON_ERROR_STOP=1 \
        -c "\copy ($compact_query) TO '$transfer_file' WITH (FORMAT binary)"
    psql "$target_url" -X --set=ON_ERROR_STOP=1 \
        -c "\copy public.\"$target_table\" ($columns) FROM '$transfer_file' WITH (FORMAT binary)"
    rm -f "$transfer_file"
}

copy_table() {
    target_database="$1"
    table="$2"
    target_url="$(admin_url "$target_database")"

    if ! table_exists "$target_url" "$table"; then
        echo "[database-migration] target migration did not create $target_database.$table" >&2
        exit 1
    fi
    if ! table_exists "$LEGACY_URL" "$table"; then
        echo "[database-migration] source table $table does not exist; target remains empty"
        return
    fi

    find_common_columns "$table" "$target_database" "$table"
    copy_query "$target_database" "$table" "$COMMON_COLUMNS" \
        "SELECT $COMMON_COLUMNS FROM public.\"$table\"" \
        "${target_database}_${table}"
}

assert_targets_empty() {
    echo "[database-migration] checking that target data tables are empty"
    for route in $TABLE_ROUTES; do
        database="${route%%:*}"
        table="${route#*:}"
        url="$(admin_url "$database")"
        if ! table_exists "$url" "$table"; then
            echo "[database-migration] missing target table $database.$table" >&2
            exit 1
        fi
        count="$(table_count "$url" "$table")"
        if [ "$count" -ne 0 ]; then
            echo "[database-migration] refusing non-empty target $database.$table ($count rows)" >&2
            exit 1
        fi
    done

    for database in create_story_gateway create_story_voices create_story_drive_sync create_story_auto_audio; do
        url="$(admin_url "$database")"
        if ! table_exists "$url" app_settings; then
            echo "[database-migration] missing target table $database.app_settings" >&2
            exit 1
        fi
        count="$(table_count "$url" app_settings)"
        if [ "$count" -ne 0 ]; then
            echo "[database-migration] refusing non-empty target $database.app_settings ($count rows)" >&2
            exit 1
        fi
    done
}

check_active_work() {
    psql "$LEGACY_URL" -X --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    item record;
    active_count bigint;
BEGIN
    FOR item IN
        SELECT * FROM (VALUES
            ('drive_sync_jobs'),
            ('bedread_audio_jobs'),
            ('generated_audio_files'),
            ('crawl_sessions'),
            ('auto_audio_sessions')
        ) AS active_tables(table_name)
    LOOP
        IF to_regclass('public.' || quote_ident(item.table_name)) IS NOT NULL THEN
            EXECUTE format(
                'SELECT count(*) FROM public.%I WHERE lower(coalesce(status::text, '''')) = ANY '
                || '(ARRAY[''queued'',''pending'',''running'',''processing'',''in_progress'',''starting'',''crawling''])',
                item.table_name
            ) INTO active_count;
            IF active_count > 0 THEN
                RAISE EXCEPTION '% has % active rows; finish or cancel them before migration',
                    item.table_name, active_count;
            END IF;
        END IF;
    END LOOP;
END $$;
SQL
    echo "[database-migration] active-work preflight passed"
}

backup_legacy() {
    mkdir -p /backups
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="/backups/create_story_legacy_${stamp}.dump"
    pg_dump "$LEGACY_URL" --format=custom --no-owner --no-privileges --file="$backup"
    sha256sum "$backup" > "${backup}.sha256"
    echo "[database-migration] backup: $backup"
    echo "[database-migration] checksum: ${backup}.sha256"
}

reset_sequences() {
    for database in $TARGET_DATABASES; do
        psql "$(admin_url "$database")" -X --set=ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
    seq record;
    maximum bigint;
BEGIN
    FOR seq IN
        SELECT
            table_name,
            column_name,
            pg_get_serial_sequence('public.' || quote_ident(table_name), column_name) AS sequence_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'
    LOOP
        EXECUTE format('SELECT max(%I) FROM public.%I', seq.column_name, seq.table_name) INTO maximum;
        IF maximum IS NULL THEN
            PERFORM setval(seq.sequence_name::regclass, 1, false);
        ELSE
            PERFORM setval(seq.sequence_name::regclass, maximum, true);
        END IF;
    END LOOP;
END $$;
SQL
    done
}

record_cutover_marker() {
    psql "$(admin_url create_story_gateway)" -X --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.migration_audit (
    id, source_path, target_table, row_count, imported_at, notes
)
VALUES (
    md5('create-story-database-per-service-settings-split')::uuid,
    'database://create_story',
    'database_per_service_cutover',
    0,
    CURRENT_TIMESTAMP,
    'Database-per-service copy and validation completed before traffic reopened.'
)
ON CONFLICT (id) DO NOTHING;
SQL
}

copy_split_settings() {
    if ! table_exists "$LEGACY_URL" app_settings; then
        echo "[database-migration] source app_settings does not exist; no settings to split"
        return
    fi

    columns='"key", "value", "updated_at"'
    copy_query create_story_gateway app_settings "$columns" "$GATEWAY_SETTINGS_QUERY" gateway_app_settings
    copy_query create_story_drive_sync app_settings "$columns" "$DRIVE_SETTINGS_QUERY" drive_app_settings
    copy_query create_story_auto_audio app_settings "$columns" "$AUTO_SETTINGS_QUERY" auto_audio_app_settings
    copy_query create_story_voices app_settings "$columns" "$VOICES_SETTINGS_QUERY" voices_app_settings

    # Keep the exact pre-split document in the Gateway archive even though the
    # live Gateway row now contains only UI/crawl fields.
    gateway_url="$(admin_url create_story_gateway)"
    archive_exists="$(psql "$gateway_url" -X -Atqc "
        SELECT count(*) FROM public.shared_json_documents
        WHERE id = md5('create-story-user-settings-pre-database-split')::uuid
           OR (namespace = 'migration_archive' AND key = 'user_settings_pre_database_split')")"
    if [ "$archive_exists" -eq 0 ]; then
        archive_query="
            SELECT
                md5('create-story-user-settings-pre-database-split')::uuid,
                'migration_archive'::varchar(128),
                'user_settings_pre_database_split'::varchar(255),
                value,
                'database://create_story/app_settings/user_settings'::text,
                updated_at
            FROM public.app_settings WHERE key = 'user_settings'"
        copy_query create_story_gateway shared_json_documents \
            '"id", "namespace", "key", "data", "source_path", "updated_at"' \
            "$archive_query" user_settings_archive
    fi

    # Archive the complete legacy settings map as one immutable JSON document.
    # This preserves standalone/unclassified setting rows without treating them
    # as live Gateway-owned configuration.
    settings_archive_exists="$(psql "$gateway_url" -X -Atqc "
        SELECT count(*) FROM public.shared_json_documents
        WHERE id = md5('create-story-app-settings-pre-database-split')::uuid
           OR (namespace = 'migration_archive' AND key = 'app_settings_pre_database_split')")"
    if [ "$settings_archive_exists" -eq 0 ]; then
        settings_archive_query="
            SELECT
                md5('create-story-app-settings-pre-database-split')::uuid,
                'migration_archive'::varchar(128),
                'app_settings_pre_database_split'::varchar(255),
                jsonb_object_agg(key, value ORDER BY key),
                'database://create_story/app_settings'::text,
                max(updated_at)
            FROM public.app_settings
            HAVING count(*) > 0"
        copy_query create_story_gateway shared_json_documents \
            '"id", "namespace", "key", "data", "source_path", "updated_at"' \
            "$settings_archive_query" app_settings_archive
    fi

    unknown_count="$(psql "$LEGACY_URL" -X -Atqc "
        WITH unknown_rows AS (
            SELECT key FROM public.app_settings
            WHERE key <> 'user_settings'
              AND key NOT IN ('drive_sync_config', 'auto_scan_state', 'auto_audio_settings', 'tts_settings')
              AND key NOT LIKE 'metadata_update_%_cache'
        ), unknown_user_fields AS (
            SELECT setting_key
            FROM public.app_settings source
            CROSS JOIN LATERAL jsonb_object_keys(source.value) AS keys(setting_key)
            WHERE source.key = 'user_settings'
              AND setting_key NOT IN (
                'theme', 'crawl_mode', 'crawl_default_count',
                'crawl_default_range_from', 'crawl_default_range_to',
                'crawl_auto_max_chapters', 'tts_concurrency'
              )
              AND setting_key NOT LIKE 'auto_audio_%'
        )
        SELECT (SELECT count(*) FROM unknown_rows) + (SELECT count(*) FROM unknown_user_fields)")"
    unknown_names="$(psql "$LEGACY_URL" -X -Atqc "
        WITH names AS (
            SELECT 'row:' || key AS name FROM public.app_settings
            WHERE key <> 'user_settings'
              AND key NOT IN ('drive_sync_config', 'auto_scan_state', 'auto_audio_settings', 'tts_settings')
              AND key NOT LIKE 'metadata_update_%_cache'
            UNION ALL
            SELECT 'user_settings.' || setting_key
            FROM public.app_settings source
            CROSS JOIN LATERAL jsonb_object_keys(source.value) AS keys(setting_key)
            WHERE source.key = 'user_settings'
              AND setting_key NOT IN (
                'theme', 'crawl_mode', 'crawl_default_count',
                'crawl_default_range_from', 'crawl_default_range_to',
                'crawl_auto_max_chapters', 'tts_concurrency'
              )
              AND setting_key NOT LIKE 'auto_audio_%'
        )
        SELECT coalesce(string_agg(name, ', ' ORDER BY name), 'none') FROM names")"
    echo "[database-migration] unclassified settings preserved in Gateway migration archive: $unknown_names"

    audit_id="$(psql "$gateway_url" -X -Atqc "
        SELECT md5('create-story-settings-split-audit')::uuid")"
    audit_exists="$(psql "$gateway_url" -X -Atqc "
        SELECT count(*) FROM public.migration_audit WHERE id = '$audit_id'::uuid")"
    if [ "$audit_exists" -eq 0 ]; then
        audit_query="
            SELECT
                md5('create-story-settings-split-audit')::uuid,
                'database://create_story/app_settings'::text,
                'app_settings'::varchar(128),
                $unknown_count::integer,
                CURRENT_TIMESTAMP,
                'Unclassified settings were preserved in the Gateway migration archive; see migration output.'::text"
        copy_query create_story_gateway migration_audit \
            '"id", "source_path", "target_table", "row_count", "imported_at", "notes"' \
            "$audit_query" settings_migration_audit
    fi
}

fingerprint_query() {
    url="$1"
    query="$2"
    psql "$url" -X -Atqc "
        SELECT count(*)::text || '|' || md5(coalesce(string_agg(row_hash, '' ORDER BY row_hash), ''))
        FROM (
            SELECT md5(to_jsonb(row_value)::text) AS row_hash
            FROM ($query) AS row_value
        ) AS fingerprints"
}

validate_table() {
    target_database="$1"
    table="$2"
    target_url="$(admin_url "$target_database")"

    if ! table_exists "$target_url" "$table"; then
        echo "[database-migration] validation missing target $target_database.$table" >&2
        exit 1
    fi
    if ! table_exists "$LEGACY_URL" "$table"; then
        actual="$(table_count "$target_url" "$table")"
        [ "$actual" -eq 0 ] || {
            echo "[database-migration] expected empty $target_database.$table, found $actual rows" >&2
            exit 1
        }
        return
    fi

    find_common_columns "$table" "$target_database" "$table"
    filter=""
    case "$table" in
        shared_json_documents)
            filter="WHERE id NOT IN (
                md5('create-story-user-settings-pre-database-split')::uuid,
                md5('create-story-app-settings-pre-database-split')::uuid
            )"
            ;;
        migration_audit)
            filter="WHERE id NOT IN (
                md5('create-story-database-per-service-settings-split')::uuid,
                md5('create-story-settings-split-audit')::uuid
            )"
            ;;
    esac
    source_fingerprint="$(fingerprint_query "$LEGACY_URL" "SELECT $COMMON_COLUMNS FROM public.\"$table\" $filter")"
    target_fingerprint="$(fingerprint_query "$target_url" "SELECT $COMMON_COLUMNS FROM public.\"$table\" $filter")"
    if [ "$source_fingerprint" != "$target_fingerprint" ]; then
        echo "[database-migration] fingerprint mismatch for $table: source=$source_fingerprint target=$target_fingerprint" >&2
        exit 1
    fi
    echo "[database-migration] validated $target_database.$table ($target_fingerprint)"
}

validate_settings_query() {
    label="$1"
    target_database="$2"
    source_query="$3"
    target_filter="$4"
    target_url="$(admin_url "$target_database")"
    expected="$(fingerprint_query "$LEGACY_URL" "$source_query")"
    actual="$(fingerprint_query "$target_url" "SELECT key, value, updated_at FROM public.app_settings WHERE $target_filter")"
    if [ "$expected" != "$actual" ]; then
        echo "[database-migration] settings mismatch for $label: source=$expected target=$actual" >&2
        exit 1
    fi
    echo "[database-migration] validated $label settings ($actual)"
}

assert_schema() {
    database="$1"
    allowed_sql="$2"
    unexpected="$(psql "$(admin_url "$database")" -X -Atqc "
        SELECT coalesce(string_agg(tablename, ', ' ORDER BY tablename), '')
        FROM pg_tables
        WHERE schemaname = 'public' AND tablename NOT IN ($allowed_sql)")"
    if [ -n "$unexpected" ]; then
        echo "[database-migration] unexpected tables in $database: $unexpected" >&2
        exit 1
    fi
}

validate_role_isolation() {
    for own_database in $TARGET_DATABASES; do
        own_url="$(target_url_secret "$own_database")"
        identity="$(psql "$own_url" -X -Atqc "SELECT current_user || '@' || current_database()")"
        echo "[database-migration] role check: $identity"
        base_url="${own_url%/*}"
        for other_database in $TARGET_DATABASES; do
            [ "$other_database" = "$own_database" ] && continue
            if psql "$base_url/$other_database" -X -Atqc "SELECT 1" >/dev/null 2>&1; then
                echo "[database-migration] isolation failure: $identity can connect to $other_database" >&2
                exit 1
            fi
        done
    done
    echo "[database-migration] database role isolation validated"
}

validate_all() {
    for route in $TABLE_ROUTES; do
        database="${route%%:*}"
        table="${route#*:}"
        validate_table "$database" "$table"
    done

    if table_exists "$LEGACY_URL" app_settings; then
        # Use explicit filters; the Gateway also contains its archive/audit only
        # in other tables, so every app_settings row must match the routed query.
        gateway_expected="$(fingerprint_query "$LEGACY_URL" "$GATEWAY_SETTINGS_QUERY")"
        gateway_actual="$(fingerprint_query "$(admin_url create_story_gateway)" "SELECT key, value, updated_at FROM public.app_settings")"
        [ "$gateway_expected" = "$gateway_actual" ] || {
            echo "[database-migration] Gateway settings mismatch: $gateway_expected != $gateway_actual" >&2
            exit 1
        }
        validate_settings_query drive create_story_drive_sync "$DRIVE_SETTINGS_QUERY" "TRUE"
        validate_settings_query auto_audio create_story_auto_audio "$AUTO_SETTINGS_QUERY" "TRUE"
        validate_settings_query voices create_story_voices "$VOICES_SETTINGS_QUERY" "TRUE"
    fi

    assert_schema create_story_gateway \
        "'users','refresh_tokens','app_settings','shared_json_documents','migration_audit','alembic_version_gateway'"
    assert_schema create_story_crawler \
        "'crawl_sessions','crawl_output_files','inkitt_cookies','scribblehub_cookies','goodnovel_cookies','webnovel_cookies','alembic_version_crawler'"
    assert_schema create_story_voices \
        "'bedread_audio_jobs','generated_audio_files','app_settings','alembic_version_voices'"
    assert_schema create_story_drive_sync \
        "'drive_sync_status','drive_sync_history','drive_sync_jobs','cover_update_histories','banner_update_histories','intro_update_histories','app_settings','external_credentials','alembic_version_drive'"
    assert_schema create_story_auto_audio \
        "'auto_audio_sessions','auto_audio_completed_stories','app_settings','alembic_version_auto_audio'"
    validate_role_isolation
    record_cutover_marker
    echo "[database-migration] all row counts, fingerprints, schemas, and role boundaries are valid"
}

show_plan() {
    echo "[database-migration] source: legacy create_story (never modified or deleted)"
    echo "[database-migration] targets: gateway, crawler, voices, drive_sync, auto_audio"
    for route in $TABLE_ROUTES; do
        database="${route%%:*}"
        table="${route#*:}"
        if table_exists "$LEGACY_URL" "$table"; then
            count="$(table_count "$LEGACY_URL" "$table")"
        else
            count=0
        fi
        echo "  $table ($count rows) -> $database"
    done
    echo "  app_settings -> split by owner; complete legacy settings archived in Gateway"
    printf '%s\n' '  backups -> C:\ProgramData\CreateStory\backups'
}

case "$MODE" in
    plan)
        show_plan
        ;;
    preflight)
        check_active_work
        assert_targets_empty
        ;;
    backup)
        backup_legacy
        ;;
    copy)
        check_active_work
        assert_targets_empty
        for route in $TABLE_ROUTES; do
            database="${route%%:*}"
            table="${route#*:}"
            copy_table "$database" "$table"
        done
        copy_split_settings
        reset_sequences
        echo "[database-migration] copy complete; legacy database remains untouched"
        ;;
    validate)
        validate_all
        ;;
    *)
        echo "[database-migration] invalid MIGRATION_MODE=$MODE (plan|preflight|backup|copy|validate)" >&2
        exit 2
        ;;
esac
