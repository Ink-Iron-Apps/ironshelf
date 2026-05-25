#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Ironshelf Windows installer.
.DESCRIPTION
    Downloads the latest Ironshelf release for Windows, installs the binary,
    creates config, registers a Windows Service, and adds a firewall rule.
#>

$ErrorActionPreference = "Stop"

$Repo = "LightWraith8268/ironshelf"
$ServiceName = "Ironshelf"
$ServiceDisplayName = "Ironshelf Ebook Server"
$BinaryName = "ironshelf-server.exe"
$ArtifactName = "ironshelf-server-windows-x86_64.exe"
$DefaultPort = 10810
$InstallDir = "$env:ProgramFiles\Ironshelf"
$ConfigDir = "$env:APPDATA\Ironshelf"
$ConfigPath = "$ConfigDir\config.toml"
$BinaryPath = "$InstallDir\$BinaryName"

function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Err { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red; exit 1 }

# --- Get latest release download URL ---

Write-Info "Fetching latest release from GitHub..."
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"

try {
    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "Ironshelf-Installer" }
} catch {
    Write-Err "Failed to query GitHub releases API: $_"
}

$Asset = $Release.assets | Where-Object { $_.name -eq $ArtifactName } | Select-Object -First 1
if (-not $Asset) {
    Write-Err "Could not find asset '$ArtifactName' in the latest release. Check https://github.com/$Repo/releases"
}

$DownloadUrl = $Asset.browser_download_url
Write-Info "Download URL: $DownloadUrl"

# --- Download binary ---

Write-Info "Creating install directory: $InstallDir"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

Write-Info "Downloading binary..."
Invoke-WebRequest -Uri $DownloadUrl -OutFile $BinaryPath -UseBasicParsing
Write-Info "Binary installed to $BinaryPath"

# --- Create default config ---

if (-not (Test-Path $ConfigPath)) {
    Write-Info "Creating default config at $ConfigPath"
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null

    $ConfigContent = @"
# Ironshelf Configuration

[server]
host = "0.0.0.0"
port = $DefaultPort

# Add library sources below.
# Each [[library]] entry defines one library.

# Example: Calibre library
# [[library]]
# name = "Main Library"
# source = "calibre"
# path = "C:\\Users\\YourName\\Calibre Library"

# Example: Folder scan
# [[library]]
# name = "Unsorted Books"
# source = "folder"
# path = "D:\\Ebooks"
"@
    Set-Content -Path $ConfigPath -Value $ConfigContent -Encoding UTF8
} else {
    Write-Info "Config already exists at $ConfigPath, not overwriting."
}

# --- Register Windows Service ---

Write-Info "Registering Windows Service..."

# Stop existing service if running
$ExistingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingService) {
    Write-Info "Stopping existing service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Create the service using sc.exe
# The binary path includes the config environment variable via a wrapper approach.
# Since sc.exe cannot set env vars directly, we use a wrapper cmd.
$WrapperScript = "$InstallDir\start-ironshelf.cmd"
$WrapperContent = @"
@echo off
set IRONSHELF_CONFIG=$ConfigPath
set RUST_LOG=ironshelf_server=info
"$BinaryPath"
"@
Set-Content -Path $WrapperScript -Value $WrapperContent -Encoding ASCII

sc.exe create $ServiceName binPath= "`"$WrapperScript`"" start= auto DisplayName= "$ServiceDisplayName" | Out-Null
sc.exe description $ServiceName "Self-hosted ebook server with Calibre integration" | Out-Null

# Start the service
Write-Info "Starting service..."
Start-Service -Name $ServiceName

# --- Firewall rule ---

Write-Info "Adding firewall rule for port $DefaultPort..."
$RuleName = "Ironshelf Server (TCP $DefaultPort)"
$ExistingRule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if (-not $ExistingRule) {
    New-NetFirewallRule -DisplayName $RuleName `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $DefaultPort `
        -Action Allow `
        -Profile Private, Domain | Out-Null
    Write-Info "Firewall rule created."
} else {
    Write-Info "Firewall rule already exists."
}

# --- Done ---

Write-Host ""
Write-Host "=== Ironshelf Installed (Windows) ===" -ForegroundColor Green
Write-Host ""
Write-Host "Running at:  http://localhost:$DefaultPort"
Write-Host "Binary:      $BinaryPath"
Write-Host "Config:      $ConfigPath"
Write-Host "Service:     $ServiceName (auto-start)"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Edit $ConfigPath to add your library paths"
Write-Host "  2. Restart after config changes:"
Write-Host "     Restart-Service $ServiceName"
Write-Host ""
