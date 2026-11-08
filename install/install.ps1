# LahLah Video installer for Windows.
#   irm https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.ps1 | iex
# Dry run (find the download, change nothing):
#   $env:LAHLAH_DRY_RUN = '1'; irm https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.ps1 | iex
# Specific version:  $env:LAHLAH_VERSION = 'v2.0.0'; irm ... | iex

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster
  $Repo = 'alfredang/LahLahVideo'
  $App = 'LahLah Video'

  function Say($msg) { Write-Host "==> $msg" -ForegroundColor Magenta }

  if ($env:OS -ne 'Windows_NT') {
    Write-Host 'This installer is for Windows. On a Mac, open Terminal and run:' -ForegroundColor Yellow
    Write-Host '  curl -fsSL https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.sh | bash'
    return
  }

  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

  $version = if ($env:LAHLAH_VERSION) { $env:LAHLAH_VERSION } else { 'latest' }
  $api = if ($version -eq 'latest') { "https://api.github.com/repos/$Repo/releases/latest" } else { "https://api.github.com/repos/$Repo/releases/tags/$version" }
  Say "Looking up the $version release of $App"
  $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'lahlah-installer'; 'Accept' = 'application/vnd.github+json' }
  $asset = $release.assets | Where-Object { $_.name -like '*x64-setup.exe' } | Select-Object -First 1
  if (-not $asset) { throw "The $($release.tag_name) release has no Windows installer yet. See https://github.com/$Repo/releases" }
  $sizeMb = [math]::Round($asset.size / 1MB, 1)
  Say "Found $($release.tag_name): $($asset.name) ($sizeMb MB)"
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Say 'Windows on ARM: the x64 app runs under Windows emulation.' }

  if ($env:LAHLAH_DRY_RUN -eq '1') {
    Say "Dry run. Would download $($asset.browser_download_url), install it silently for this user, add a desktop shortcut and open it."
    return
  }

  $installer = Join-Path $env:TEMP $asset.name
  Say 'Downloading'
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer -UseBasicParsing
  Unblock-File -Path $installer   # skip the SmartScreen "downloaded from the internet" prompt

  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('lahlah-video', 'LahLah Video') } | Stop-Process -Force -ErrorAction SilentlyContinue

  Say 'Installing (no admin rights needed)'
  $p = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "The installer stopped with code $($p.ExitCode)." }
  Remove-Item $installer -ErrorAction SilentlyContinue

  # Find the installed program: the uninstall registry entry first, then the usual folders.
  $exe = $null
  $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')
  $entry = Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "$App*" } | Select-Object -First 1
  if ($entry -and $entry.DisplayIcon) {
    $candidate = ($entry.DisplayIcon -split ',')[0].Trim('"')
    if (Test-Path $candidate) { $exe = $candidate }
  }
  if (-not $exe) {
    foreach ($dir in @((Join-Path $env:LOCALAPPDATA $App), (Join-Path $env:LOCALAPPDATA "Programs\$App"), (Join-Path $env:ProgramFiles $App))) {
      if ($entry -and $entry.InstallLocation) { $dir = $entry.InstallLocation.Trim('"') }
      if (Test-Path $dir) {
        $found = Get-ChildItem -Path $dir -Filter '*.exe' | Where-Object { $_.Name -notmatch 'uninstall' } | Select-Object -First 1
        if ($found) { $exe = $found.FullName; break }
      }
    }
  }
  if (-not $exe) { throw "Installed, but could not find $App. Look for it in the Start menu." }

  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop "$App.lnk"
  if (-not (Test-Path $lnk)) {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $exe
    $sc.WorkingDirectory = Split-Path $exe
    $sc.Save()
  }

  Say "Starting $App"
  Start-Process -FilePath $exe
  Write-Host ''
  Write-Host "LahLah Video $($release.tag_name) is installed and should now be open." -ForegroundColor Green
  Write-Host "  App: $exe"
  Write-Host '  Tip: press Ctrl+K inside the app and type "help" to see what you can say.'
}
