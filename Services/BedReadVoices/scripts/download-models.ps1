#requires -Version 5.1
<#
.SYNOPSIS
    Download the Kokoro ONNX model files for BedReadVoices from the CreateStory GitHub Release.

.DESCRIPTION
    kokoro-v1.0.onnx (~310 MB) and voices-v1.0.bin (~25 MB) are too large to commit, so they
    live as assets on the CreateStory release (tag "models-v1.0"), not in git.

    Works whether the CreateStory repo is public or private:
      * public  -> downloads directly, no auth needed
      * private -> the direct URLs 404 without auth; install the GitHub CLI and run
                   `gh auth login` first. This script auto-uses `gh` when it is on PATH.

    Idempotent for valid files. Docker-created directory stubs and tiny placeholder
    files are removed and replaced.

.EXAMPLE
    # Local dev: populate Services/BedReadVoices/api/models
    powershell scripts/download-models.ps1

.EXAMPLE
    # Customize output folder (if overriding KOKORO_MODELS_DIR)
    powershell scripts/download-models.ps1 -OutDir C:\CustomModelsFolder
#>
[CmdletBinding()]
param(
    [string]$Repo   = "hatrumtruong27/CreateStory",
    [string]$Tag    = "models-v1.0",
    [string]$OutDir = (Join-Path $PSScriptRoot "..\api\models"),
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$files = "kokoro-v1.0.onnx", "voices-v1.0.bin"
$minimumBytes = @{
    "kokoro-v1.0.onnx" = 310MB
    "voices-v1.0.bin" = 24MB
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
Write-Host "Repo:   $Repo (tag $Tag)"
Write-Host "Target: $OutDir"

if ($Force) {
    foreach ($name in $files) {
        $path = Join-Path $OutDir $name
        if (Test-Path -LiteralPath $path) {
            if (Test-Path -LiteralPath $path -PathType Container) {
                Write-Host "[force] Removing existing directory stub $name."
                Remove-Item -LiteralPath $path -Recurse -Force
            } else {
                Write-Host "[force] Removing existing model file $name for redownload."
                Remove-Item -LiteralPath $path -Force
            }
        }
    }
}


function Test-ValidModelFile([string]$Path, [string]$Name) {
    if (Test-Path -LiteralPath $Path -PathType Container) {
        Write-Host "[fix ] $Name is a Docker-created directory stub; removing it."
        Remove-Item -LiteralPath $Path -Recurse -Force
        return $false
    }

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    $size = (Get-Item -LiteralPath $Path).Length
    if ($size -lt $minimumBytes[$Name]) {
        Write-Host "[fix ] $Name is too small ($size bytes); removing it."
        Remove-Item -LiteralPath $Path -Force
        return $false
    }

    Write-Host "[skip] $Name already present ($size bytes)."
    return $true
}

function Assert-ValidModelFile([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Name was not downloaded to $Path"
    }
    $size = (Get-Item -LiteralPath $Path).Length
    if ($size -lt $minimumBytes[$Name]) {
        throw "$Name is still invalid after download ($size bytes at $Path)"
    }
}

foreach ($name in $files) {
    Test-ValidModelFile (Join-Path $OutDir $name) $name | Out-Null
}

# Prefer the GitHub CLI when present: it transparently handles auth, private repos,
# and the S3 redirect that a hand-rolled token download trips over.
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    Write-Host "Using GitHub CLI (gh)."
    $ghArgs = @("release", "download", $Tag, "--repo", $Repo, "--dir", $OutDir, "--skip-existing")
    foreach ($f in $files) { $ghArgs += @("--pattern", $f) }
    & gh @ghArgs
    foreach ($name in $files) {
        Assert-ValidModelFile (Join-Path $OutDir $name) $name
    }
    Write-Host "Done."
    return
}

Write-Host "gh not found -- using direct download (works while the repo is public)."
foreach ($name in $files) {
    $dest = Join-Path $OutDir $name
    if (Test-ValidModelFile $dest $name) {
        continue
    }
    $url = "https://github.com/$Repo/releases/download/$Tag/$name"
    Write-Host "[get ] $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        Assert-ValidModelFile $dest $name
        Write-Host "[done] $dest"
    } catch {
        Remove-Item $dest -ErrorAction SilentlyContinue
        throw "Failed to download $name. If the repo is now private, install the GitHub CLI " +
              "(https://cli.github.com), run 'gh auth login', then re-run this script. " +
              "Underlying error: $($_.Exception.Message)"
    }
}
Write-Host "Done."
