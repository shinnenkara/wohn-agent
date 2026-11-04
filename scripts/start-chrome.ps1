$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$profileDir = Join-Path $root "chrome-profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) {
  throw "Google Chrome was not found. Install Chrome and run this script again."
}

Write-Host "Starting headed Chrome with profile $profileDir on port 9222"
& $chrome `
  --remote-debugging-port=9222 `
  --remote-allow-origins=* `
  --enable-unsafe-extension-debugging `
  --enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport `
  --user-data-dir="$profileDir" `
  --no-first-run `
  --new-window "https://www.immobilienscout24.de/"
