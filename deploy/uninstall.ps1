#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Ironshelf Windows uninstaller.
.DESCRIPTION
    Stops and removes the Ironshelf service, binary, firewall rule,
    and optionally config/data.
#>

$ErrorActionPreference = "Stop"

$ServiceName = "Ironshelf"
$DefaultPort = 10810
$InstallDir = "$env:ProgramFiles\Ironshelf"
$ConfigDir = "$env:APPDATA\Ironshelf"
$FirewallRuleName = "Ironshelf Server (TCP $DefaultPort)"

function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }

function Confirm-Removal {
    param([string]$Target)
    $answer = Read-Host "Remove ${Target}? [y/N]"
    return ($answer -match "^[Yy]$")
}

Write-Host ""
Write-Host "=== Ironshelf Uninstaller (Windows) ===" -ForegroundColor Yellow
Write-Host ""

# --- Stop and remove service ---

$ExistingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingService) {
    Write-Info "Stopping service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Info "Removing service..."
    sc.exe delete $ServiceName | Out-Null
} else {
    Write-Info "Service not found, skipping."
}

# --- Remove firewall rule ---

$ExistingRule = Get-NetFirewallRule -DisplayName $FirewallRuleName -ErrorAction SilentlyContinue
if ($ExistingRule) {
    Write-Info "Removing firewall rule..."
    Remove-NetFirewallRule -DisplayName $FirewallRuleName
} else {
    Write-Info "Firewall rule not found, skipping."
}

# --- Remove binary directory ---

if (Test-Path $InstallDir) {
    Write-Info "Removing install directory: $InstallDir"
    Remove-Item -Path $InstallDir -Recurse -Force
} else {
    Write-Info "Install directory not found, skipping."
}

# --- Optionally remove config ---

if (Test-Path $ConfigDir) {
    if (Confirm-Removal "config directory ($ConfigDir)") {
        Write-Info "Removing config directory..."
        Remove-Item -Path $ConfigDir -Recurse -Force
    } else {
        Write-Info "Keeping config directory."
    }
}

# --- Done ---

Write-Host ""
Write-Host "=== Ironshelf Uninstalled (Windows) ===" -ForegroundColor Green
Write-Host ""
