<#
.SYNOPSIS
    Drop-in replacement for go-task (task.exe), which Smart App Control blocks.

.DESCRIPTION
    Mirrors the tasks defined in Taskfile.yml. Keep the two files in sync when
    adding or changing tasks.

.EXAMPLE
    .\task.ps1                      # list all tasks (same as `task default`)
    .\task.ps1 update:all-noFE
    .\task.ps1 backup:restore -- 20260714T030000Z
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)][string]$TaskName = 'default',
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

# Everything after the task name (a leading "--" is stripped, like go-task's CLI_ARGS)
$CliArgs = @($Rest | Where-Object { $_ -ne '--' }) -join ' '

function Invoke-Step {
    param([string]$Command, [switch]$IgnoreError)
    Write-Host ">> $Command" -ForegroundColor Cyan
    cmd /c $Command
    if (-not $IgnoreError -and $LASTEXITCODE -ne 0) {
        throw "Step failed (exit $LASTEXITCODE): $Command"
    }
}

$Tasks = [ordered]@{}

$Tasks['default'] = @{
    Desc   = 'List all available tasks'
    Action = {
        Write-Host "Available tasks (run with .\task.ps1 <name>):`n"
        foreach ($name in $Tasks.Keys) {
            Write-Host ('  {0,-24} {1}' -f $name, $Tasks[$name].Desc)
        }
    }
}

$Tasks['start'] = @{
    Desc   = 'Build and start the backend compose stack in the foreground'
    Deps   = @('database:provision')
    Action = { Invoke-Step "docker compose up --build $CliArgs" }
}

$Tasks['start:bg'] = @{
    Desc   = 'Build and start the backend compose stack in the background'
    Deps   = @('database:provision')
    Action = { Invoke-Step "docker compose up -d --build $CliArgs" }
}

$Tasks['clean'] = @{
    Desc   = 'Force stop all containers and remove volumes, networks, and local images'
    Action = {
        Invoke-Step 'docker compose down -v --rmi local --remove-orphans'
        Invoke-Step 'docker rm -f create-story-database-provisioner create-story-fastapi-gateway create-story-bedread-voices create-story-bedread-drive-sync create-story-novel-crawler create-story-auto-audio create-story-flaresolverr create-story-frontend create-story-postgres 2>nul' -IgnoreError
    }
}

$Tasks['start:fresh'] = @{
    Desc   = 'Clean everything, reset secrets, verify models, start stack, and run admin setup'
    Action = {
        Invoke-Task 'clean'
        Invoke-Task 'secrets:reset'
        Invoke-Task 'models:check'
        Invoke-Task 'start:bg'
        Write-Host 'Waiting for API Gateway to become healthy...'
        Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/wait_container_healthy.ps1 -Container create-story-fastapi-gateway -Label Gateway'
        Invoke-Task 'admin'
    }
}

$Tasks['secrets:ensure'] = @{
    Desc   = 'Generate missing secret files only (idempotent setup)'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup_secrets.ps1 -Mode ensure' }
}

$Tasks['secrets:delete'] = @{
    Desc   = 'Delete current secret files'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup_secrets.ps1 -Mode delete' }
}

$Tasks['secrets:reset'] = @{
    Desc   = 'Delete and regenerate all secret files'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup_secrets.ps1 -Mode reset' }
}

$Tasks['secrets:ci'] = @{
    Desc   = 'Generate an ignored .ci-secrets directory for the CI Compose override'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup_secrets.ps1 -Mode ensure -SecretDirectory ./.ci-secrets' }
}

$Tasks['database:provision'] = @{
    Desc   = 'Run the disposable setup tool to create/update service databases and roles'
    Deps   = @('secrets:ensure')
    Action = {
        Invoke-Step 'docker compose run --rm database_provisioner'
        Invoke-Step 'docker rm -f create-story-database-provisioner 2>nul' -IgnoreError
    }
}

$Tasks['backup:database'] = @{
    Desc   = 'Create and verify a backup set for all five service databases'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_backup.ps1 -Mode backup' }
}

$Tasks['backup:list'] = @{
    Desc   = 'List complete service-database backup sets'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_backup.ps1 -Mode list' }
}

$Tasks['backup:restore-latest'] = @{
    Desc   = 'Safely restore all five databases from the latest complete backup'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_backup.ps1 -Mode restore-latest' }
}

$Tasks['backup:restore'] = @{
    Desc   = 'Restore a selected backup ID: .\task.ps1 backup:restore -- YYYYMMDDTHHMMSSZ'
    Action = { Invoke-Step "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_backup.ps1 -Mode restore -BackupSet `"$CliArgs`"" }
}

$Tasks['backup:schedule-install'] = @{
    Desc   = 'Install daily backup schedule (default 03:00/14 days; accepts PowerShell options)'
    Action = { Invoke-Step "powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_backup.ps1 -Mode schedule-install $CliArgs" }
}

$Tasks['backup:schedule-remove'] = @{
    Desc   = 'Remove the Windows daily database-backup schedule'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_backup.ps1 -Mode schedule-remove' }
}

$Tasks['migration:plan'] = @{
    Desc   = 'Read-only inventory of legacy rows and their target service database'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_migration.ps1 -Mode plan' }
}

$Tasks['migration:apply'] = @{
    Desc   = 'Backup, copy, validate, and cut over to database-per-service'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_migration.ps1 -Mode apply' }
}

$Tasks['migration:validate'] = @{
    Desc   = 'Validate row hashes, owned schemas, and cross-database role denial'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_migration.ps1 -Mode validate' }
}

$Tasks['migration:rollback'] = @{
    Desc   = 'Pre-reopening rollback: reconnect all services to untouched legacy database'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/database_migration.ps1 -Mode rollback' }
}

$Tasks['models:check'] = @{
    Desc   = 'Verify presence and integrity of Kokoro models (downloads if missing/corrupt)'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/download-models.ps1' }
}

$Tasks['models:force-update'] = @{
    Desc   = 'Stop stack, remove models, download fresh assets, and rebuild/restart services'
    Action = {
        Invoke-Step 'docker compose stop bedread_voices auto_audio'
        Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/download-models.ps1 -Force'
        Invoke-Step 'docker compose up -d --build bedread_voices auto_audio'
    }
}

$Tasks['admin'] = @{
    Desc   = 'Set up the initial admin account using interactive prompts'
    Action = { Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup_admin.ps1' }
}

$Tasks['build:frontend'] = @{
    Desc   = 'Compile Vite production bundle and move it into Services/frontend-dist'
    Action = {
        Invoke-Step 'docker compose stop frontend 2>nul' -IgnoreError
        if (Test-Path '..\CreateStory_FE') {
            if (Get-Command npm -ErrorAction SilentlyContinue) {
                Push-Location '..\CreateStory_FE'
                try {
                    Invoke-Step 'npm install'
                    Invoke-Step 'npm run build'
                }
                finally { Pop-Location }
                if (Test-Path '.\frontend-dist') { Remove-Item -Recurse -Force '.\frontend-dist' }
                Copy-Item -Path '..\CreateStory_FE\dist' -Destination '.\frontend-dist' -Recurse -Force
            }
            else { Write-Host '[WARN] npm not found. Skipping frontend compilation.' }
        }
        else { Write-Host '[INFO] CreateStory_FE directory not found. Using existing frontend-dist.' }
        Invoke-Step 'docker compose up -d frontend 2>nul' -IgnoreError
    }
}

$Tasks['update:all'] = @{
    Desc   = 'Build frontend, rebuild, and reload all compose services'
    Deps   = @('database:provision')
    Action = {
        Invoke-Task 'build:frontend'
        Invoke-Step 'docker compose up -d --build'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:all-noFE'] = @{
    Desc   = 'Rebuild and reload all compose services, skipping frontend compilation'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:backend'] = @{
    Desc   = 'Rebuild and reload all backend compose services (no frontend build)'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build postgres fastapi_gateway bedread_voices novel_crawler flaresolverr bedread_drive_sync auto_audio'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:gateway'] = @{
    Desc   = 'Update fastapi_gateway service (no-deps rebuild)'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build --no-deps fastapi_gateway'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:voices'] = @{
    Desc   = 'Update bedread_voices service (no-deps rebuild)'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build --no-deps bedread_voices'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:crawler'] = @{
    Desc   = 'Update novel_crawler service (no-deps rebuild)'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build --no-deps novel_crawler'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:sync'] = @{
    Desc   = 'Update bedread_drive_sync service (no-deps rebuild)'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build --no-deps bedread_drive_sync'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:audio'] = @{
    Desc   = 'Update auto_audio service (no-deps rebuild)'
    Deps   = @('database:provision')
    Action = {
        Invoke-Step 'docker compose up -d --build --no-deps auto_audio'
        Invoke-Step 'docker image prune -f 2>nul' -IgnoreError
    }
}

$Tasks['update:frontend-only'] = @{
    Desc   = 'Restart the nginx frontend container only'
    Action = { Invoke-Step 'docker compose restart frontend' }
}

$Tasks['export'] = @{
    Desc   = 'Build frontend and package the microservices workspace into a zip archive'
    Action = {
        Invoke-Task 'build:frontend'
        Invoke-Step 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/export_services.ps1'
    }
}

$Tasks['start:frontend'] = @{
    Desc   = 'Start the local Vite React development server on http://localhost:5173'
    Action = {
        Push-Location '..\CreateStory_FE'
        try {
            Invoke-Step 'npm install'
            Invoke-Step 'npm run dev'
        }
        finally { Pop-Location }
    }
}

# --- runner ---------------------------------------------------------------

$script:CompletedTasks = @{}

function Invoke-Task {
    param([string]$Name)
    if (-not $Tasks.Contains($Name)) {
        Write-Host "Unknown task: $Name" -ForegroundColor Red
        Write-Host "Run .\task.ps1 to list available tasks."
        exit 1
    }
    if ($script:CompletedTasks.ContainsKey($Name)) { return }
    foreach ($dep in @($Tasks[$Name].Deps)) {
        if ($dep) { Invoke-Task $dep }
    }
    Write-Host "== task: $Name ==" -ForegroundColor Green
    & $Tasks[$Name].Action
    $script:CompletedTasks[$Name] = $true
}

Push-Location $PSScriptRoot
try {
    Invoke-Task $TaskName
}
finally {
    Pop-Location
}
