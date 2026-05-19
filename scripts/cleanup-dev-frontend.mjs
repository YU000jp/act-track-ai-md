import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const targetPattern = String.raw`scripts[\\/]dev-frontend\.mjs`;

export function cleanupDevFrontend() {
  if (process.platform === "win32") {
    const script = `
$staleProcesses = @()

$staleProcesses += Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "node.exe" -and $_.CommandLine -and $_.CommandLine -match '${targetPattern}'
}

$staleProcesses += Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "act-track-ai-md.exe"
}

$staleProcesses += Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq "cargo.exe" -and $_.CommandLine -and $_.CommandLine -match 'run --no-default-features'
}

if (-not $staleProcesses) {
  Write-Host "[cleanup-dev] no stale dev processes found"
  exit 0
}

$staleProcesses = $staleProcesses | Where-Object { $_.ProcessId } | Sort-Object ProcessId -Unique

if (-not $staleProcesses) {
  Write-Host "[cleanup-dev] no stale dev processes found"
  exit 0
}

$staleProcesses | ForEach-Object {
  try {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    Write-Host "[cleanup-dev] stopped $($_.ProcessId) $($_.Name)"
  } catch {
    Write-Host "[cleanup-dev] failed to stop $($_.ProcessId) $($_.Name): $($_.Exception.Message)"
  }
}
`;

    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    return;
  }

  const result = spawnSync("pkill", ["-f", "scripts/dev-frontend.mjs"], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cleanupDevFrontend();
}
