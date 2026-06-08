param(
    [string]$ApiDomain,
    [string]$FrontendDomain
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root ".env.production"
$exampleFile = Join-Path $root ".env.production.example"

function New-HexSecret([int]$bytes) {
    $buffer = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return ($buffer | ForEach-Object { $_.ToString("x2") }) -join ""
}

if (-not (Test-Path $envFile)) {
    $content = Get-Content $exampleFile -Raw
    $content = $content -replace "(?m)^BACKEND_AUTH_TOKEN=.*$", "BACKEND_AUTH_TOKEN=$(New-HexSecret 32)"
    $content = $content -replace "(?m)^JWT_SECRET=.*$", "JWT_SECRET=$(New-HexSecret 32)"
    $content = $content -replace "(?m)^MARIADB_PASSWORD=.*$", "MARIADB_PASSWORD=$(New-HexSecret 24)"
    $content = $content -replace "(?m)^MARIADB_ROOT_PASSWORD=.*$", "MARIADB_ROOT_PASSWORD=$(New-HexSecret 24)"
    $content = $content -replace "(?m)^TELEGRAM_WEBHOOK_SECRET=.*$", "TELEGRAM_WEBHOOK_SECRET=$(New-HexSecret 32)"
    if ($ApiDomain) {
        $content = $content -replace "(?m)^API_DOMAIN=.*$", "API_DOMAIN=$ApiDomain"
    }
    if ($FrontendDomain) {
        $content = $content -replace "(?m)^FRONTEND_DOMAIN=.*$", "FRONTEND_DOMAIN=$FrontendDomain"
        $content = $content -replace "(?m)^CORS_ALLOW_ORIGINS=.*$", "CORS_ALLOW_ORIGINS=https://$FrontendDomain"
    }
    Set-Content -Path $envFile -Value $content -Encoding UTF8
    Write-Host "Created .env.production with generated secrets."
}

Push-Location $root
try {
    docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
}
finally {
    Pop-Location
}
