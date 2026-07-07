#requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$Container,

    [Parameter(Mandatory = $true)]
    [string]$Label,

    [int]$MaxTries = 60,
    [int]$SleepSeconds = 5
)

$template = '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'

for ($try = 1; $try -le $MaxTries; $try++) {
    $status = (& docker inspect -f $template $Container 2>$null | Select-Object -First 1)
    if ($null -ne $status) {
        $status = $status.Trim()
    }

    if ($status -eq 'healthy') {
        Write-Host "[OK] $Label is healthy."
        exit 0
    }

    if ($status -eq 'exited') {
        Write-Host ""
        Write-Host "[ERROR] $Label exited before becoming healthy."
        & docker logs --tail 80 $Container
        exit 1
    }

    if ([string]::IsNullOrWhiteSpace($status)) {
        $status = 'not-found'
    }

    Write-Host "[wait] $Label status: $status ($try/$MaxTries)"
    Start-Sleep -Seconds $SleepSeconds
}

Write-Host ""
Write-Host "[ERROR] Timed out waiting for $Label. Last status: $status"
if ($status -ne 'not-found') {
    & docker logs --tail 80 $Container
}
exit 1
