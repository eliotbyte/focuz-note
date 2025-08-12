Param(
  [switch]$Rebuild,
  [switch]$AttachLogs
)

$ErrorActionPreference = "Stop"

Write-Host "Starting API test environment..." -ForegroundColor Green

if ($Rebuild) {
  docker compose -f docker-compose.test.yml build --no-cache
}

# Ensure clean slate
try { docker compose -f docker-compose.test.yml down -v --remove-orphans | Out-Null } catch {}

# Start in detached mode to avoid interactive UI (no keyboard hints / blocking)
docker compose -f docker-compose.test.yml up -d --build

# Optionally stream logs while waiting
if ($AttachLogs) {
  Start-Job -ScriptBlock { docker compose -f docker-compose.test.yml logs -f } | Out-Null
}

# Prefer compose 'wait' if available; fallback to manual wait
$exitCode = 0
$waitSupported = $false
try {
  docker compose -f docker-compose.test.yml wait test-runner | Out-Null
  $waitSupported = $true
} catch {
  $waitSupported = $false
}

if ($waitSupported) {
  # Get exit code via inspect on the named container
  $exitCode = (docker inspect -f "{{.State.ExitCode}}" focuz-test-runner)
} else {
  # Poll until container exits, then read exit code
  do {
    Start-Sleep -Seconds 1
    $status = (docker inspect -f "{{.State.Status}}" focuz-test-runner 2>$null)
  } while ($status -ne "exited" -and $status -ne "dead")
  $exitCode = (docker inspect -f "{{.State.ExitCode}}" focuz-test-runner)
}

Write-Host "Cleaning up API test environment..." -ForegroundColor Green
try { docker compose -f docker-compose.test.yml down -v --remove-orphans | Out-Null } catch {}

# Exit with the test runner's exit code to integrate with CI and close the window automatically
exit [int]$exitCode 