$ErrorActionPreference = 'Stop'

$temp = $env:RUNNER_TEMP
$novnc = Join-Path $temp 'noVNC'
$installer = Join-Path $temp 'tightvnc.msi'
$cloudflared = Join-Path $temp 'cloudflared.exe'

function Wait-ForLocalPort([int]$Port, [string]$ServiceName) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $client.Connect('127.0.0.1', $Port)
      return
    } catch {
      Start-Sleep -Seconds 1
    } finally {
      $client.Dispose()
    }
  }
  throw "$ServiceName did not start listening on port $Port."
}

if ($env:DESKTOP_PASSWORD -and $env:DESKTOP_PASSWORD -notmatch '^[a-zA-Z0-9]{1,8}$') {
  throw 'TightVNC passwords must contain 1-8 ASCII letters or numbers.'
}

Invoke-WebRequest `
  -Uri 'https://www.tightvnc.com/download/2.8.90/tightvnc-2.8.90-gpl-setup-64bit.msi' `
  -OutFile $installer

$msiArgs = @(
  '/i', $installer, '/quiet', '/norestart',
  'ADDLOCAL=Server',
  'SET_ALLOWLOOPBACK=1',
  'VALUE_OF_ALLOWLOOPBACK=1',
  'SERVER_REGISTER_AS_SERVICE=1',
  'SERVER_ADD_FIREWALL_EXCEPTION=1',
  'SET_USEVNCAUTHENTICATION=1'
)
if ($env:DESKTOP_PASSWORD) {
  $msiArgs += @('VALUE_OF_USEVNCAUTHENTICATION=1', 'SET_PASSWORD=1', "VALUE_OF_PASSWORD=$env:DESKTOP_PASSWORD")
} else {
  $msiArgs += 'VALUE_OF_USEVNCAUTHENTICATION=0'
}

$install = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru
if ($install.ExitCode -notin @(0, 3010)) {
  throw "TightVNC installation failed with exit code $($install.ExitCode)."
}

$service = Get-Service -Name tvnserver -ErrorAction Stop
if ($service.Status -ne 'Running') {
  Start-Service -Name tvnserver
}
Wait-ForLocalPort -Port 5900 -ServiceName 'TightVNC'

git clone --depth 1 --branch v1.6.0 https://github.com/novnc/noVNC.git $novnc
if ($LASTEXITCODE -ne 0) {
  throw "Could not download noVNC (exit code $LASTEXITCODE)."
}
python -m pip install --disable-pip-version-check websockify==0.12.0
if ($LASTEXITCODE -ne 0) {
  throw "Could not install websockify (exit code $LASTEXITCODE)."
}
$pythonScripts = python -c "import sysconfig; print(sysconfig.get_path('scripts'))"
if ($LASTEXITCODE -ne 0) {
  throw "Could not determine the Python scripts directory (exit code $LASTEXITCODE)."
}
$websockify = Join-Path $pythonScripts 'websockify.exe'
if (-not (Test-Path $websockify)) {
  throw "websockify was not installed at $websockify."
}

$websockifyArgs = @('--web', $novnc, '127.0.0.1:6080', '127.0.0.1:5900')
$websockifyProcess = Start-Process -FilePath $websockify -ArgumentList $websockifyArgs -WindowStyle Hidden -PassThru
Wait-ForLocalPort -Port 6080 -ServiceName 'noVNC'
if ($websockifyProcess.HasExited) {
  throw "websockify exited with code $($websockifyProcess.ExitCode)."
}

Invoke-WebRequest `
  -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
  -OutFile $cloudflared

$browser = $env:DESKTOP_BROWSER
$browserPath = switch ($browser) {
  'chrome' { 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
  'chromium' { 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
  'msedge' { 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
  'firefox' { 'C:\Program Files\Mozilla Firefox\firefox.exe' }
  default { $null }
}

$browserProcess = $null
if ($browserPath) {
  if (-not (Test-Path $browserPath)) {
    throw "$browser is not installed at $browserPath."
  }

  $browserArgs = @()
  if ($env:DESKTOP_PROFILE_DIR) {
    New-Item -ItemType Directory -Force -Path $env:DESKTOP_PROFILE_DIR | Out-Null
    if ($browser -eq 'firefox') {
      $browserArgs += @('-profile', $env:DESKTOP_PROFILE_DIR)
    } else {
      $browserArgs += "--user-data-dir=$env:DESKTOP_PROFILE_DIR"
    }
  }
  $browserArgs += 'https://duckduckgo.com/'
  $browserProcess = Start-Process -FilePath $browserPath -ArgumentList $browserArgs -PassThru
}

try {
  node .github/actions/windows-desktop/start.js $cloudflared
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop tunnel exited with code $LASTEXITCODE."
  }
} finally {
  if ($browserProcess -and -not $browserProcess.HasExited) {
    Stop-Process -Id $browserProcess.Id -Force
  }
}
