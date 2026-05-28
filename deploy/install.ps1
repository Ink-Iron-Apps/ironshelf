#Requires -Version 5.1
<#
.SYNOPSIS
    Ironshelf Windows installer.
.DESCRIPTION
    Downloads the latest Ironshelf release for Windows, installs the binary,
    creates config, registers a Windows Service, and adds a firewall rule.
    Runs prerequisite checks before installation.
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
$MinDiskMB = 500
$VCRedistUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"

function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red; exit 1 }

# --- Prerequisite checks ---

function Test-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Err "This installer must be run as Administrator. Right-click PowerShell and select 'Run as Administrator'."
    }
    Write-Info "Running as Administrator."
}

function Test-WindowsVersion {
    $osVersion = [System.Environment]::OSVersion.Version
    $osCaption = (Get-CimInstance Win32_OperatingSystem).Caption

    # Windows 10 = 10.0.10240+, Server 2016 = 10.0.14393+
    if ($osVersion.Major -lt 10) {
        Write-Err "Ironshelf requires Windows 10 or Server 2016 or later. Detected: $osCaption ($osVersion)"
    }

    Write-Info "Windows version: $osCaption ($osVersion)"
}

function Test-DiskSpace {
    $targetDrive = (Split-Path -Qualifier $InstallDir)
    if (-not $targetDrive) { $targetDrive = "C:" }

    try {
        $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$targetDrive'"
        if ($disk) {
            $freeSpaceMB = [math]::Floor($disk.FreeSpace / 1MB)
            if ($freeSpaceMB -lt $MinDiskMB) {
                Write-Err "Insufficient disk space on ${targetDrive}: ${freeSpaceMB}MB available, ${MinDiskMB}MB required."
            }
            Write-Info "Disk space on ${targetDrive}: ${freeSpaceMB}MB available."
        } else {
            Write-Warn "Could not determine disk space for $targetDrive. Proceeding anyway."
        }
    } catch {
        Write-Warn "Could not check disk space: $_. Proceeding anyway."
    }
}

function Test-VCRedist {
    # Check for Visual C++ Redistributable 2019+ by looking for vcruntime140.dll
    $vcRuntimePath = "$env:SystemRoot\System32\vcruntime140.dll"
    $vcRuntime2Path = "$env:SystemRoot\System32\vcruntime140_1.dll"

    if (Test-Path $vcRuntimePath) {
        $fileVersion = (Get-Item $vcRuntimePath).VersionInfo.ProductVersion
        Write-Info "Visual C++ Redistributable found: vcruntime140.dll v$fileVersion"

        # vcruntime140_1.dll is needed for VS 2019+ builds (added in 14.20)
        if (-not (Test-Path $vcRuntime2Path)) {
            Write-Warn "vcruntime140_1.dll not found. You may need a newer Visual C++ Redistributable."
            Write-Warn "Download from: $VCRedistUrl"
            Write-Host ""
            $response = Read-Host "Would you like to download and install it now? (y/N)"
            if ($response -eq "y" -or $response -eq "Y") {
                Install-VCRedist
            } else {
                Write-Warn "Proceeding without update. Ironshelf may fail to start if the runtime is too old."
            }
        }
    } else {
        Write-Warn "Visual C++ Redistributable not found (vcruntime140.dll missing)."
        Write-Warn "Ironshelf requires the Visual C++ Redistributable 2019 or later."
        Write-Warn "Download from: $VCRedistUrl"
        Write-Host ""
        $response = Read-Host "Would you like to download and install it now? (y/N)"
        if ($response -eq "y" -or $response -eq "Y") {
            Install-VCRedist
        } else {
            Write-Err "Cannot proceed without Visual C++ Redistributable. Install it manually and re-run this installer."
        }
    }
}

function Install-VCRedist {
    $tempPath = "$env:TEMP\vc_redist.x64.exe"
    Write-Info "Downloading Visual C++ Redistributable..."
    try {
        Invoke-WebRequest -Uri $VCRedistUrl -OutFile $tempPath -UseBasicParsing
        Write-Info "Installing Visual C++ Redistributable (this may take a moment)..."
        $process = Start-Process -FilePath $tempPath -ArgumentList "/install", "/quiet", "/norestart" -Wait -PassThru
        if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 1638) {
            # 1638 = already installed/newer version present
            Write-Info "Visual C++ Redistributable installed successfully."
        } else {
            Write-Warn "VC++ Redistributable installer exited with code $($process.ExitCode). You may need to install manually."
        }
    } catch {
        Write-Warn "Failed to download/install VC++ Redistributable: $_"
        Write-Warn "Please install manually from: $VCRedistUrl"
    } finally {
        Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
    }
}

function Test-OptionalTools {
    # ebook-convert (Calibre CLI) — used for format conversion
    $ebookConvert = Get-Command "ebook-convert" -ErrorAction SilentlyContinue
    if ($ebookConvert) {
        try {
            $versionOutput = & ebook-convert --version 2>&1 | Select-Object -First 1
            Write-Info "Found ebook-convert: $versionOutput"
            Write-Info "  Format conversion feature will be available."
        } catch {
            Write-Info "Found ebook-convert at $($ebookConvert.Source) (could not determine version)."
        }
        $script:EbookConvertAvailable = $true
    } else {
        # Also check common Calibre install paths
        $calibrePaths = @(
            "$env:ProgramFiles\Calibre2\ebook-convert.exe",
            "${env:ProgramFiles(x86)}\Calibre2\ebook-convert.exe",
            "$env:LOCALAPPDATA\Programs\Calibre2\ebook-convert.exe"
        )
        $found = $false
        foreach ($path in $calibrePaths) {
            if (Test-Path $path) {
                Write-Info "Found ebook-convert at: $path (not in PATH)"
                Write-Info "  Consider adding Calibre to PATH for format conversion."
                $found = $true
                $script:EbookConvertAvailable = $true
                break
            }
        }
        if (-not $found) {
            Write-Info "ebook-convert not found (optional)."
            Write-Info "  Install Calibre to enable format conversion (epub <-> mobi, pdf, etc.)."
            Write-Info "  https://calibre-ebook.com/download"
            $script:EbookConvertAvailable = $false
        }
    }
}

function Write-SystemSummary {
    Write-Host ""
    Write-Host "=== System Information ===" -ForegroundColor White
    Write-Host ""
    Write-Host "  Platform:       Windows x86_64"
    Write-Host "  OS:             $((Get-CimInstance Win32_OperatingSystem).Caption)"
    Write-Host "  PowerShell:     $($PSVersionTable.PSVersion)"
    Write-Host "  Install target: $InstallDir"

    if ($script:EbookConvertAvailable) {
        Write-Host "  ebook-convert:  found (format conversion enabled)"
    } else {
        Write-Host "  ebook-convert:  not found (format conversion unavailable)"
    }

    Write-Host "  TLS backend:    rustls (bundled, no system OpenSSL required)"
    Write-Host ""
}

function Invoke-PreflightChecks {
    Write-Info "Running preflight checks..."
    Write-Host ""

    Test-Administrator
    Test-WindowsVersion
    Test-DiskSpace
    Test-VCRedist
    Test-OptionalTools
    Write-SystemSummary
}

# --- Main installation ---

Write-Host ""
Write-Host "=== Ironshelf Installer ===" -ForegroundColor Green
Write-Host ""

# Run all preflight checks before touching anything
Invoke-PreflightChecks

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
# See https://github.com/LightWraith8268/ironshelf for documentation.

host = "0.0.0.0"
port = $DefaultPort
database_path = "$($InstallDir -replace '\\', '\\\\')\\ironshelf.db"

# search_index_path = "$($InstallDir -replace '\\', '\\\\')\\ironshelf-search-index\\"
# thumbnail_cache_path = "$($InstallDir -replace '\\', '\\\\')\\ironshelf-thumbnail-cache\\"
# tls_enabled = false
# trust_proxy_headers = false

# Libraries are managed through the web UI, not this file.

# Optional: OIDC/SSO login (Authelia, Authentik, Keycloak, etc.)
# [oidc]
# issuer_url = "https://auth.example.com"
# client_id = "ironshelf"
# client_secret = "your-secret"
# redirect_uri = "https://books.example.com/api/v1/auth/oidc/callback"
# scopes = ["openid", "profile", "email"]
# auto_register = true
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

# Create the service using sc.exe with the binary directly.
# Environment variables are set via the service registry key since sc.exe
# cannot set them and .cmd wrappers are not valid service executables.
sc.exe create $ServiceName binPath= "`"$BinaryPath`"" start= auto DisplayName= "$ServiceDisplayName" | Out-Null
sc.exe description $ServiceName "Self-hosted ebook server with Calibre integration" | Out-Null

# Set environment variables for the service via registry.
# The "Environment" multi-string value is read by the Service Control Manager.
$RegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
$EnvValues = @(
    "IRONSHELF_CONFIG=$ConfigPath",
    "RUST_LOG=ironshelf_server=info"
)
Set-ItemProperty -Path $RegPath -Name "Environment" -Value $EnvValues -Type MultiString

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
Write-Host "  1. Open http://localhost:$DefaultPort and register your admin account"
Write-Host "  2. Add libraries via Settings -> Libraries in the web UI"
Write-Host "  3. Config file: $ConfigPath"
Write-Host "  4. Restart after config changes:"
Write-Host "     Restart-Service $ServiceName"
Write-Host ""
