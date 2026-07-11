#!/bin/sh
set -eu

secret() {
    value="$(cat "/run/secrets/$1")"
    if [ -z "$value" ]; then
        echo "[database-provisioner] empty secret: $1" >&2
        exit 1
    fi
    printf '%s' "$value"
}

export PGPASSWORD="$(secret postgres_password)"

provision() {
    role_name="$1"
    database_name="$2"
    role_password="$(secret "$3")"

    echo "[database-provisioner] ensuring $database_name (owner $role_name)"

    psql -X --set=ON_ERROR_STOP=1 \
        --set=role_name="$role_name" \
        --set=database_name="$database_name" \
        --set=role_password="$role_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'role_name', :'role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'role_name')
\gexec

SELECT format(
    'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
    :'role_name', :'role_password'
)
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'database_name', :'role_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database_name')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'role_name')
\gexec
SELECT format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', :'database_name')
\gexec
SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I', :'database_name', :'role_name')
\gexec
SQL

    psql -X --set=ON_ERROR_STOP=1 \
        --dbname="$database_name" \
        --set=role_name="$role_name" <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('ALTER SCHEMA public OWNER TO %I', :'role_name')
\gexec
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'role_name')
\gexec
SQL
}

provision create_story_gateway create_story_gateway gateway_database_password
provision create_story_crawler create_story_crawler crawler_database_password
provision create_story_voices create_story_voices voices_database_password
provision create_story_drive_sync create_story_drive_sync drive_sync_database_password
provision create_story_auto_audio create_story_auto_audio auto_audio_database_password

# Prevent a routine `docker compose up --build` from silently opening an empty
# set of service databases while a populated legacy database still exists. The
# maintenance workflow opts out only long enough to migrate and then writes the
# validated cutover marker checked here.
if [ "${ALLOW_LEGACY_WITH_EMPTY_TARGETS:-0}" != "1" ]; then
    legacy_has_data=0
    for table in users refresh_tokens app_settings shared_json_documents migration_audit \
        crawl_sessions crawl_output_files inkitt_cookies scribblehub_cookies \
        goodnovel_cookies webnovel_cookies bedread_audio_jobs generated_audio_files \
        drive_sync_status drive_sync_history drive_sync_jobs cover_update_histories \
        banner_update_histories intro_update_histories external_credentials \
        auto_audio_sessions auto_audio_completed_stories; do
        exists="$(psql -X -Atqc "SELECT to_regclass('public.$table') IS NOT NULL")"
        if [ "$exists" = "t" ]; then
            count="$(psql -X -Atqc "SELECT count(*) FROM public.\"$table\"")"
            if [ "$count" -gt 0 ]; then
                legacy_has_data=1
                break
            fi
        fi
    done

    cutover_complete=0
    marker_table="$(psql --dbname=create_story_gateway -X -Atqc \
        "SELECT to_regclass('public.migration_audit') IS NOT NULL")"
    if [ "$marker_table" = "t" ]; then
        marker="$(psql --dbname=create_story_gateway -X -Atqc \
            "SELECT EXISTS (SELECT 1 FROM public.migration_audit WHERE id = md5('create-story-database-per-service-settings-split')::uuid)")"
        [ "$marker" = "t" ] && cutover_complete=1
    fi

    if [ "$legacy_has_data" -eq 1 ] && [ "$cutover_complete" -ne 1 ]; then
        echo "[database-provisioner] populated legacy database detected without a validated cutover marker." >&2
        echo "[database-provisioner] Run: task migration:plan, then task migration:apply during maintenance." >&2
        exit 1
    fi
fi

echo "[database-provisioner] five private databases are ready"
