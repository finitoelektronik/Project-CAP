param(
  [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release\CAP-Analytics-Setup.exe')
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$nodeRuntime = 'C:\Users\adits\.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
$pythonRuntime = 'C:\Users\adits\.cache\codex-runtimes\codex-primary-runtime\dependencies\python'
$source = Join-Path $root 'installer\CAPInstaller.cs'

if (-not (Test-Path -LiteralPath $compiler)) { throw 'Compiler .NET Framework Windows tidak tersedia.' }
if (-not (Test-Path -LiteralPath (Join-Path $nodeRuntime 'bin\node.exe'))) { throw 'Runtime Node bawaan tidak ditemukan.' }
if (-not (Test-Path -LiteralPath (Join-Path $pythonRuntime 'python.exe'))) { throw 'Runtime Python bawaan tidak ditemukan.' }

$stage = Join-Path $env:TEMP ('cap-native-build-' + [guid]::NewGuid().ToString('N'))
$payloadRoot = Join-Path $stage 'payload'
$zip = Join-Path $stage 'cap-analytics-payload.zip'
try {
  New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
  $launcherSource = Join-Path $root 'installer\CAPLauncher.cs'
  $startLauncher = Join-Path $root 'CAP Analytics.exe'
  $restartLauncher = Join-Path $root 'Restart CAP Analytics.exe'
  & $compiler '/nologo' '/target:winexe' ("/out:$startLauncher") '/reference:System.Windows.Forms.dll' $launcherSource
  if ($LASTEXITCODE -ne 0) { throw 'Pembuatan peluncur CAP gagal.' }
  Copy-Item -LiteralPath $startLauncher -Destination $restartLauncher -Force
  $files = @('app.mjs','start-dev.ps1','Start-CAP-Analytics.cmd','Start-CAP-Analytics.ps1','Restart-CAP-Analytics.cmd','Restart-CAP-Server-Admin.ps1','CAP Analytics.exe','Restart CAP Analytics.exe','CAP-Recovery.cmd','CAP-Recovery.ps1','CAP-Server-Autostart.ps1','Run-CAP-Server.ps1','Aktifkan-Akses-LAN.ps1','Aktifkan-AutoStart.ps1','Aktifkan-AutoStart-Pengguna.ps1','Install-CAP-Analytics.ps1','PANDUAN_INSTALASI.md','MODULE_PACKAGE_SPEC.md','CONTEXT.md')
  foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $root $file) -Destination $payloadRoot -Force }
  foreach ($folder in @('public','scripts')) { Copy-Item -LiteralPath (Join-Path $root $folder) -Destination $payloadRoot -Recurse -Force }
  New-Item -ItemType Directory -Path (Join-Path $payloadRoot 'runtime') -Force | Out-Null
  Copy-Item -LiteralPath $nodeRuntime -Destination (Join-Path $payloadRoot 'runtime\node') -Recurse -Force
  Copy-Item -LiteralPath $pythonRuntime -Destination (Join-Path $payloadRoot 'runtime\python') -Recurse -Force
  Compress-Archive -Path (Get-ChildItem -LiteralPath $payloadRoot -Force | Select-Object -ExpandProperty FullName) -DestinationPath $zip -CompressionLevel Optimal -Force

  $targetDir = Split-Path -Parent $OutputPath
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  if (Test-Path -LiteralPath $OutputPath) { Remove-Item -LiteralPath $OutputPath -Force }
  & $compiler '/nologo' '/target:winexe' ("/out:$OutputPath") '/reference:System.IO.Compression.dll' '/reference:System.IO.Compression.FileSystem.dll' '/reference:System.Windows.Forms.dll' ("/resource:$zip,CAPPayload") $source
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) { throw 'Pembuatan EXE installer gagal.' }
  Get-Item -LiteralPath $OutputPath | Select-Object FullName,Length,LastWriteTime
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
