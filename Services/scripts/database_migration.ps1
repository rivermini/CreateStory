#requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('plan', 'apply', 'validate', 'rollback')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'
$ServicesDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AppServices = @('fastapi_gateway', 'novel_crawler', 'bedread_voices', 'bedread_drive_sync', 'auto_audio')
$WorkerServices = @('novel_crawler', 'bedread_voices', 'bedread_drive_sync', 'auto_audio', 'flaresolverr')

Push-Location $ServicesDir
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker CLI is not installed or is not on PATH.'
    }

    function Invoke-Compose {
        param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArgs)
        & docker compose @ComposeArgs
        if ($LASTEXITCODE -ne 0) {
            throw "docker compose failed ($LASTEXITCODE): $($ComposeArgs -join ' ')"
        }
    }

    function Invoke-MigrationContainer([string]$MigrationMode) {
        Invoke-Compose --profile migration run --rm -e "MIGRATION_MODE=$MigrationMode" database_migrator
    }

    function Wait-Healthy([string]$Container, [string]$Label) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/wait_container_healthy.ps1 `
            -Container $Container -Label $Label
        if ($LASTEXITCODE -ne 0) {
            throw "$Label did not become healthy."
        }
    }

    function Save-PreMigrationImages {
        $images = [ordered]@{
            fastapi_gateway    = 'create-story-rollback-fastapi-gateway:pre-db-split'
            novel_crawler      = 'create-story-rollback-novel-crawler:pre-db-split'
            bedread_voices     = 'create-story-rollback-bedread-voices:pre-db-split'
            bedread_drive_sync = 'create-story-rollback-bedread-drive-sync:pre-db-split'
            auto_audio         = 'create-story-rollback-auto-audio:pre-db-split'
        }

        foreach ($service in $images.Keys) {
            $containerId = ((& docker compose ps -q $service) | Select-Object -First 1)
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
                throw "Cannot capture the pre-migration image for $service; its current container is not available."
            }
            $imageId = ((& docker inspect --format '{{.Image}}' $containerId) | Select-Object -First 1)
            if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageId)) {
                throw "Cannot inspect the pre-migration image for $service."
            }
            & docker image tag $imageId $images[$service]
            if ($LASTEXITCODE -ne 0) {
                throw "Cannot tag the rollback image for $service."
            }
            Write-Host "[migration] Saved rollback image: $service -> $($images[$service])"
        }
    }

    # Safe and idempotent; existing credentials (especially the legacy URL) are
    # deliberately left untouched.
    & powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup_secrets.ps1 -Mode ensure
    if ($LASTEXITCODE -ne 0) {
        throw 'Secret setup failed.'
    }

    switch ($Mode) {
        'plan' {
            Invoke-MigrationContainer plan
        }

        'validate' {
            Invoke-MigrationContainer validate
        }

        'apply' {
            Write-Host '[migration] Capturing the exact currently-running application images for rollback...'
            Save-PreMigrationImages

            Write-Host '[migration] Building current service images without interrupting the running stack...'
            Invoke-Compose build @AppServices

            Write-Host '[migration] Provisioning five private databases and roles...'
            Invoke-Compose run --rm -e ALLOW_LEGACY_WITH_EMPTY_TARGETS=1 database_provisioner

            Write-Host '[migration] Applying each service-owned Alembic chain to its empty target...'
            foreach ($service in $AppServices) {
                Invoke-Compose run --rm --no-deps $service alembic upgrade head
            }

            # Check before stopping anything so an operator with an active job
            # can retry later without an unnecessary outage.
            Invoke-MigrationContainer preflight

            Write-Host '[migration] Entering maintenance window; stopping public entry points and writers...'
            Invoke-Compose stop frontend @AppServices

            # Closes the small race between the first check and stopping writers.
            Invoke-MigrationContainer preflight
            Invoke-MigrationContainer backup
            Invoke-MigrationContainer copy
            Invoke-MigrationContainer validate

            Write-Host '[migration] Starting workers before the Gateway...'
            Invoke-Compose up -d @WorkerServices
            Wait-Healthy create-story-novel-crawler 'NovelCrawler'
            Wait-Healthy create-story-bedread-voices 'BedReadVoices'
            Wait-Healthy create-story-bedread-drive-sync 'BedReadDriveSync'
            Wait-Healthy create-story-auto-audio 'AutoAudio'

            Invoke-Compose up -d fastapi_gateway
            Wait-Healthy create-story-fastapi-gateway 'Gateway'
            Invoke-Compose up -d frontend
            Wait-Healthy create-story-frontend 'Frontend'

            Write-Host '[migration] Cutover complete. The legacy create_story database and backup were not modified.'
        }

        'rollback' {
            Write-Host '[migration] PRE-REOPENING ROLLBACK: stopping application containers...'
            Invoke-Compose stop frontend @AppServices

            $override = @('-f', 'docker-compose.yml', '-f', 'docker-compose.legacy-db.yml')
            Write-Host '[migration] Reconnecting workers to the untouched legacy shared database...'
            Invoke-Compose @override up -d @WorkerServices
            Wait-Healthy create-story-novel-crawler 'NovelCrawler (legacy DB)'
            Wait-Healthy create-story-bedread-voices 'BedReadVoices (legacy DB)'
            Wait-Healthy create-story-bedread-drive-sync 'BedReadDriveSync (legacy DB)'
            Wait-Healthy create-story-auto-audio 'AutoAudio (legacy DB)'

            Invoke-Compose @override up -d fastapi_gateway
            Wait-Healthy create-story-fastapi-gateway 'Gateway (legacy DB)'
            Invoke-Compose @override up -d frontend
            Wait-Healthy create-story-frontend 'Frontend'

            Write-Host '[migration] Rollback active. Continue using the legacy override for every Compose command.'
        }
    }
}
catch {
    Write-Host ''
    Write-Host "[migration] ERROR: $($_.Exception.Message)"
    if ($Mode -eq 'apply') {
        Write-Host '[migration] Traffic was not intentionally reopened after a failed cutover.'
        Write-Host '[migration] To restore the untouched legacy DB: task migration:rollback'
    }
    exit 1
}
finally {
    Pop-Location
}
