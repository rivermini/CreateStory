#requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('backup', 'list', 'restore', 'restore-latest', 'schedule-install', 'schedule-remove')]
    [string]$Mode,
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 14,
    [ValidatePattern('^(?:[01]\d|2[0-3]):[0-5]\d$')]
    [string]$ScheduleTime = '03:00',
    [string]$BackupSet,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ServicesDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$BackupRoot = 'C:\ProgramData\CreateStory\backups\service-databases'
$TaskName = 'CreateStory Daily Database Backup'
$AppServices = @('fastapi_gateway', 'novel_crawler', 'bedread_voices', 'bedread_drive_sync', 'auto_audio')
$WorkerServices = @('novel_crawler', 'bedread_voices', 'bedread_drive_sync', 'auto_audio', 'flaresolverr')

function Invoke-Compose {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArgs)
    & docker compose @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed ($LASTEXITCODE): $($ComposeArgs -join ' ')"
    }
}

function Invoke-BackupTool {
    param(
        [Parameter(Mandatory = $true)][string]$ToolMode,
        [string]$BackupSet
    )
    $arguments = @(
        'run', '--rm',
        '--env', "BACKUP_MODE=$ToolMode",
        '--env', "BACKUP_RETENTION_DAYS=$RetentionDays"
    )
    if (-not [string]::IsNullOrWhiteSpace($BackupSet)) {
        $arguments += @('--env', "BACKUP_SET=$BackupSet")
    }
    $arguments += 'database_backup'
    Invoke-Compose @arguments
}

function Get-BackupSets {
    if (-not (Test-Path -LiteralPath $BackupRoot)) {
        return @()
    }
    return @(Get-ChildItem -LiteralPath $BackupRoot -Directory |
        Where-Object { $_.Name -match '^\d{8}T\d{6}Z$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'COMPLETE')) } |
        Sort-Object Name -Descending)
}

function Wait-Healthy([string]$Container, [string]$Label) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/wait_container_healthy.ps1 `
        -Container $Container -Label $Label
    if ($LASTEXITCODE -ne 0) {
        throw "$Label did not become healthy."
    }
}

Push-Location $ServicesDir
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker CLI is not installed or is not on PATH.'
    }

    switch ($Mode) {
        'backup' {
            Invoke-BackupTool -ToolMode backup
        }

        'list' {
            $sets = Get-BackupSets
            if ($sets.Count -eq 0) {
                Write-Host "[database-backup] No complete backups found under $BackupRoot"
                break
            }
            $sets | Select-Object Name, LastWriteTime, @{Name='SizeMB'; Expression={
                [math]::Round(((Get-ChildItem -LiteralPath $_.FullName -File | Measure-Object Length -Sum).Sum / 1MB), 2)
            }} | Format-Table -AutoSize
        }

        { $_ -in @('restore', 'restore-latest') } {
            $sets = Get-BackupSets
            if ($sets.Count -eq 0) {
                throw "No complete backup sets exist under $BackupRoot."
            }
            if ($Mode -eq 'restore') {
                if ($BackupSet -notmatch '^\d{8}T\d{6}Z$') {
                    throw 'Specify a backup ID from task backup:list, for example: task backup:restore -- 20260712T012618Z'
                }
                $match = @($sets | Where-Object Name -eq $BackupSet)
                if ($match.Count -ne 1) {
                    throw "Complete backup set not found: $BackupSet"
                }
                $selected = $match[0].Name
            }
            else {
                $selected = $sets[0].Name
            }
            Invoke-BackupTool -ToolMode verify -BackupSet $selected

            if (-not $Force) {
                Write-Host ''
                Write-Host "WARNING: This replaces all five live service databases with backup $selected." -ForegroundColor Yellow
                $confirmation = Read-Host "Type RESTORE $selected to continue"
                if ($confirmation -cne "RESTORE $selected") {
                    throw 'Restore cancelled; confirmation did not match.'
                }
            }

            $safetySet = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
            Write-Host "[database-backup] Creating pre-restore safety backup $safetySet..."
            Invoke-BackupTool -ToolMode backup -BackupSet $safetySet

            Write-Host '[database-backup] Stopping frontend and application writers...'
            Invoke-Compose stop frontend @AppServices
            try {
                Invoke-BackupTool -ToolMode restore -BackupSet $selected
            }
            catch {
                Write-Host "[database-backup] Restore failed. Services remain stopped. Safety backup: $safetySet" -ForegroundColor Red
                throw
            }

            Write-Host '[database-backup] Starting workers, Gateway, and frontend...'
            Invoke-Compose up -d @WorkerServices
            Wait-Healthy create-story-novel-crawler 'NovelCrawler'
            Wait-Healthy create-story-bedread-voices 'BedReadVoices'
            Wait-Healthy create-story-bedread-drive-sync 'BedReadDriveSync'
            Wait-Healthy create-story-auto-audio 'AutoAudio'
            Invoke-Compose up -d fastapi_gateway
            Wait-Healthy create-story-fastapi-gateway 'Gateway'
            Invoke-Compose up -d frontend
            Wait-Healthy create-story-frontend 'Frontend'
            Write-Host "[database-backup] Restore finished successfully: $selected"
            Write-Host "[database-backup] Pre-restore safety backup: $safetySet"
        }

        'schedule-install' {
            $scriptPath = $MyInvocation.MyCommand.Path
            $actionArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Mode backup -RetentionDays $RetentionDays"
            $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs -WorkingDirectory $ServicesDir
            $trigger = New-ScheduledTaskTrigger -Daily -At $ScheduleTime
            $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 4)
            $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
            Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
            Write-Host "[database-backup] Scheduled daily at $ScheduleTime with $RetentionDays-day retention."
            Write-Host '[database-backup] Docker Desktop must be running and this Windows user must be signed in.'
        }

        'schedule-remove' {
            $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            if ($null -ne $existing) {
                Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            }
            Write-Host '[database-backup] Schedule removed.'
        }
    }
}
catch {
    Write-Host "[database-backup] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
