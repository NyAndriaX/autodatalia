param(
    [string[]]$PytestArgs = @("tests", "-q")
)

# Runs the backend suite inside the local Docker stack against a dedicated
# `datalia_test` database. The suite wipes every table it touches, so it must
# never run against the dev `datalia` database (conftest refuses to).
#
# app/ and tests/ are bind-mounted into caption-api, so code changes need no
# rebuild. After changing requirements*.txt, rebuild first:
#   docker compose -f infra/docker-compose.yml up -d --build caption-api

# Not "Stop": Windows PowerShell 5.1 turns docker's normal stderr progress
# output into terminating errors. Failures are detected via $LASTEXITCODE.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $root
$compose = @("compose", "-f", "infra/docker-compose.yml")

Push-Location $repoRoot
try {
    & docker @compose up -d mariadb caption-api 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose up failed."
    }

    # Create the test database and grant the app user access to it. The SQL is
    # piped on stdin (no nested quoting); __APP_USER__ is substituted inside the
    # container from its own MARIADB_USER.
    $sql = "CREATE DATABASE IF NOT EXISTS datalia_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON datalia_test.* TO '__APP_USER__'@'%';"
    $sql | & docker @compose exec -T mariadb sh -c 'sed s/__APP_USER__/$MARIADB_USER/ | mariadb -uroot -p$MARIADB_ROOT_PASSWORD'
    if ($LASTEXITCODE -ne 0) {
        throw "Could not create the datalia_test database."
    }

    & docker @compose exec -T -e MARIADB_DATABASE=datalia_test -e DATABASE_URL= caption-api python -m pytest @PytestArgs
    if ($LASTEXITCODE -ne 0) {
        throw "pytest failed."
    }
}
finally {
    Pop-Location
}
