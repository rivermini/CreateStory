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

    Idempotent: an existing file is skipped (the gh path uses --skip-existing).

.EXAMPLE
    # Local dev: populate Services/BedReadVoices/api/models
    powershell scripts/download-models.ps1

.EXAMPLE
    # Docker: populate the external folder compose mounts read-only into the container
    powershell scripts/download-models.ps1 -OutDir D:\Developer\Nova\CreateStoryModels
#>
[CmdletBinding()]
param(
    [string]$Repo   = "hatrumtruong27/CreateStory",
    [string]$Tag    = "models-v1.0",
    [string]$OutDir = (Join-Path $PSScriptRoot "..\api\models")
)

$ErrorActionPreference = "Stop"
$files = "kokoro-v1.0.onnx", "voices-v1.0.bin"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
Write-Host "Repo:   $Repo (tag $Tag)"
Write-Host "Target: $OutDir"

# Prefer the GitHub CLI when present: it transparently handles auth, private repos,
# and the S3 redirect that a hand-rolled token download trips over.
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    Write-Host "Using GitHub CLI (gh)."
    $ghArgs = @("release", "download", $Tag, "--repo", $Repo, "--dir", $OutDir, "--skip-existing")
    foreach ($f in $files) { $ghArgs += @("--pattern", $f) }
    & gh @ghArgs
    Write-Host "Done."
    return
}

Write-Host "gh not found -- using direct download (works while the repo is public)."
foreach ($name in $files) {
    $dest = Join-Path $OutDir $name
    if (Test-Path $dest) {
        Write-Host "[skip] $name already present."
        continue
    }
    $url = "https://github.com/$Repo/releases/download/$Tag/$name"
    Write-Host "[get ] $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
        Write-Host "[done] $dest"
    } catch {
        Remove-Item $dest -ErrorAction SilentlyContinue
        throw "Failed to download $name. If the repo is now private, install the GitHub CLI " +
              "(https://cli.github.com), run 'gh auth login', then re-run this script. " +
              "Underlying error: $($_.Exception.Message)"
    }
}
Write-Host "Done."
