# LahLah Video installer for Windows.
#   irm https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.ps1 | iex
# Dry run (find the download, change nothing):
#   $env:LAHLAH_DRY_RUN = '1'; irm https://raw.githubusercontent.com/alfredang/LahLahVideo/main/install/install.ps1 | iex
# Specific version:  $env:LAHLAH_VERSION = 'v1.1.0'; irm ... | iex
# Also connect Claude: $env:LAHLAH_WITH_CLAUDE = '1'; irm ... | iex

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
  $headers = @{ 'User-Agent' = 'lahlah-installer'; 'Accept' = 'application/vnd.github+json' }
  if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
  $release = $null
  try { $release = Invoke-RestMethod -Uri $api -Headers $headers } catch { }
  if ($release) {
    $asset = $release.assets | Where-Object { $_.name -like '*x64-setup.exe' } | Select-Object -First 1
    if (-not $asset) { throw "The $($release.tag_name) release has no Windows installer yet. See https://github.com/$Repo/releases" }
  } else {
    # The GitHub API limits anonymous lookups (60 an hour per network, e.g. a whole classroom).
    Say "GitHub's release list is busy; using the direct link instead"
    $base = if ($version -eq 'latest') { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$version" }
    $release = [pscustomobject]@{ tag_name = $version; assets = @() }
    $asset = [pscustomobject]@{ name = 'LahLahVideo_x64-setup.exe'; size = 0; browser_download_url = "$base/LahLahVideo_x64-setup.exe"; url = "$base/LahLahVideo_x64-setup.exe" }
  }
  $sizeMb = if ($asset.size) { [math]::Round($asset.size / 1MB, 1) } else { '?' }
  Say "Found $($release.tag_name): $($asset.name) ($sizeMb MB)"
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { Say 'Windows on ARM: the x64 app runs under Windows emulation.' }

  $rel = if ($release.tag_name -eq 'latest') { "https://github.com/$Repo/releases/latest/download" } else { "https://github.com/$Repo/releases/download/$($release.tag_name)" }
  $mcpbUrl = "$rel/lahlah-video.mcpb"
  $mcpTgz = "$rel/lahlah-video-mcp.tgz"
  $withClaude = $env:LAHLAH_WITH_CLAUDE -eq '1'

  if ($env:LAHLAH_DRY_RUN -eq '1') {
    Say "Dry run. Would download $($asset.browser_download_url), install it silently for this user (replacing any older copy), add a desktop shortcut and open it."
    if ($withClaude) { Say "Dry run. Would also open $mcpbUrl in Claude Desktop and run: claude mcp add --scope user lahlah-video -- npx -y $mcpTgz" }
    return
  }

  $installer = Join-Path $env:TEMP $asset.name
  Say 'Downloading'
  $got = $false
  try { Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installer -UseBasicParsing; $got = $true } catch { }
  if (-not $got -and $asset.url -ne $asset.browser_download_url) {
    Say 'Direct download failed; trying GitHub''s API link'
    $dl = @{ 'Accept' = 'application/octet-stream'; 'User-Agent' = 'lahlah-installer' }
    if ($env:GITHUB_TOKEN) { $dl['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }
    try { Invoke-WebRequest -Uri $asset.url -OutFile $installer -UseBasicParsing -Headers $dl; $got = $true } catch { }
  }
  if (-not $got -and (Get-Command gh -ErrorAction SilentlyContinue)) {
    # cmd /c keeps gh's stderr away from PowerShell, which treats it as an error under 'Stop'.
    & cmd /c "gh auth status >nul 2>&1"
    if ($LASTEXITCODE -eq 0) {
      Say 'Trying the GitHub CLI (gh release download)'
      $dir = Join-Path $env:TEMP "lahlah-$([guid]::NewGuid().ToString('N'))"
      New-Item -ItemType Directory -Path $dir | Out-Null
      $tagArg = if ($release.tag_name -and $release.tag_name -ne 'latest') { @($release.tag_name) } else { @() }
      $tagText = ($tagArg -join ' ')
      & cmd /c "gh release download $tagText -R $Repo -p *x64-setup.exe -D `"$dir`" >nul 2>&1"
      $file = Get-ChildItem $dir -Filter '*x64-setup.exe' | Select-Object -First 1
      if ($file) { Move-Item $file.FullName $installer -Force; $got = $true }
      Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $got) { throw "Download failed. Check your connection, or download the installer from https://github.com/$Repo/releases/latest" }
  Unblock-File -Path $installer   # skip the SmartScreen "downloaded from the internet" prompt

  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('lahlah-video', 'LahLah Video') } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

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

  if ($withClaude) {
    Say 'Connecting Claude'
    $mcpb = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads\lahlah-video.mcpb'
    try {
      $mcpbAsset = $release.assets | Where-Object { $_.name -eq 'lahlah-video.mcpb' } | Select-Object -First 1
      try { Invoke-WebRequest -Uri $mcpbUrl -OutFile $mcpb -UseBasicParsing }
      catch {
        if (-not $mcpbAsset) { throw }
        Invoke-WebRequest -Uri $mcpbAsset.url -OutFile $mcpb -UseBasicParsing -Headers @{ 'Accept' = 'application/octet-stream'; 'User-Agent' = 'lahlah-installer' }
      }
      Start-Process -FilePath $mcpb -ErrorAction Stop
      Say 'Claude Desktop is showing the LahLah Video extension: click Install.'
    } catch {
      Say "Could not open the Claude extension automatically. Double-click $mcpb with Claude Desktop installed."
    }
    if (Get-Command claude -ErrorAction SilentlyContinue) {
      if (Get-Command npx -ErrorAction SilentlyContinue) {
        & claude mcp remove --scope user lahlah-video 2>$null | Out-Null
        & claude mcp add --scope user lahlah-video -- npx -y $mcpTgz
        Say 'Claude Code can now use LahLah Video.'
      } else {
        Say 'Claude Code found but Node.js is missing; install Node.js 18+ to use the MCP server there.'
      }
    }
  }
}
