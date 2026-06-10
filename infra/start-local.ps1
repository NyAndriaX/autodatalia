param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Push-Location $root
try {
    $args = @("-f", "docker-compose.yml", "up", "-d")
    if (-not $NoBuild) {
        $args += "--build"
    }

    & docker compose @args
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up failed."
    }

    Write-Host ""
    Write-Host "Frontend: http://localhost:3005"
    Write-Host "Backend:  http://localhost:8000/health"
}
finally {
    Pop-Location
}
