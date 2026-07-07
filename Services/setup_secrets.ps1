<#
  Creates, deletes, or resets the CreateStory Docker secret files.

  Default mode is idempotent: existing files are left untouched, so the Postgres
  password and the password embedded in database_url stay in sync across runs
  and across service restarts. Only missing files are generated.

  Self-heals "directory stubs": when a secret source file is missing, Docker
  bind-mounts auto-create the source path as an EMPTY DIRECTORY on the host
  (e.g. C:\ProgramData\CreateStory\secrets\postgres_password becomes a folder).
  Writing to a directory path throws "Access is denied", so those stubs are
  removed before the real file is written.

  Files are written as UTF-8 WITHOUT a BOM and without a trailing newline so
  Postgres and the Python services read the exact value (a BOM would corrupt
  the first character).
#>
param(
    [ValidateSet('ensure', 'delete', 'reset')]
    [string]$Mode = 'ensure'
)

$ErrorActionPreference = 'Stop'

$dir = 'C:\ProgramData\CreateStory\secrets'
$secretNames = @(
    'postgres_password',
    'database_url',
    'jwt_secret_key',
    'internal_service_token',
    'cookie_encryption_key'
)

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "[secrets] ERROR: $msg"
    Write-Host "[secrets] Fix: 1) stop the stack to release the mounts:  docker compose down -v"
    Write-Host "[secrets]      2) right-click setup_secrets.bat -> Run as administrator"
    exit 1
}

try {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
} catch {
    Fail "cannot create $dir ($($_.Exception.Message))"
}

$enc = New-Object System.Text.UTF8Encoding($false)   # UTF-8, no BOM

function New-Token([int]$len) {
    -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $len | ForEach-Object { [char]$_ })
}

function Ensure-Secret([string]$name, [scriptblock]$generator) {
    $path = Join-Path $dir $name

    # Remove a Docker-created directory stub so the real file can be written.
    if (Test-Path -LiteralPath $path -PathType Container) {
        Write-Host "[secrets] $name is a leftover Docker directory stub - removing"
        try { Remove-Item -LiteralPath $path -Recurse -Force }
        catch { Fail "could not remove the directory stub at $path ($($_.Exception.Message))" }
    }

    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Write-Host "[secrets] $name already exists - leaving as-is"
        return ((Get-Content -LiteralPath $path -Raw)).Trim()
    }

    $value = (& $generator)
    try { [System.IO.File]::WriteAllText($path, $value, $enc) }
    catch { Fail "cannot write $path ($($_.Exception.Message))" }
    Write-Host "[secrets] $name created"
    return $value
}

function Remove-Secret([string]$name) {
    $path = Join-Path $dir $name

    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try { Remove-Item -LiteralPath $path -Force }
        catch { Fail "cannot delete $path ($($_.Exception.Message))" }
        Write-Host "[secrets] $name deleted"
        return
    }

    if (Test-Path -LiteralPath $path -PathType Container) {
        try { Remove-Item -LiteralPath $path -Recurse -Force }
        catch { Fail "cannot delete directory stub $path ($($_.Exception.Message))" }
        Write-Host "[secrets] $name directory stub deleted"
        return
    }

    Write-Host "[secrets] $name does not exist"
}

if ($Mode -eq 'delete' -or $Mode -eq 'reset') {
    foreach ($name in $secretNames) {
        Remove-Secret $name
    }

    if ($Mode -eq 'delete') {
        Write-Host "[secrets] Deleted requested secrets from $dir"
        exit 0
    }
}

# postgres_password first, then reuse it inside database_url so they match.
$pgpw = Ensure-Secret 'postgres_password' { New-Token 32 }
Ensure-Secret 'database_url' { "postgresql+psycopg://create_story:$pgpw@postgres:5432/create_story" } | Out-Null
Ensure-Secret 'jwt_secret_key' { New-Token 48 } | Out-Null
Ensure-Secret 'internal_service_token' { New-Token 48 } | Out-Null
Ensure-Secret 'cookie_encryption_key' { New-Token 48 } | Out-Null

Write-Host "[secrets] OK -> $dir"
