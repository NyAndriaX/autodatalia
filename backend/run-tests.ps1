param(
    [string[]]$PytestArgs = @("/home/app/tests/test_routes.py", "-q")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $root

Push-Location $repoRoot
try {
    & docker compose -f infra/docker-compose.yml up -d --build caption-api | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up failed."
    }

    & docker compose -f infra/docker-compose.yml exec -T caption-api python -m pytest @PytestArgs
    if ($LASTEXITCODE -ne 0) {
        throw "pytest failed."
    }
}
finally {
    Pop-Location
}
