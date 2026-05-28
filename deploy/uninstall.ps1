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

# --- Stop and remove scheduled task / legacy service ---

$ExistingTask = Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    Write-Info "Stopping scheduled task..."
    Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue
    Write-Info "Removing scheduled task..."
    Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false
} else {
    Write-Info "Scheduled task not found."
}

# Also clean up legacy Windows Service if it exists from older installs
$ExistingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($ExistingService) {
    Write-Info "Removing legacy Windows Service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
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
    if (Confirm-Removal "install directory ($InstallDir)") {
        Write-Info "Removing install directory..."
        Remove-Item -Path $InstallDir -Recurse -Force
    } else {
        Write-Info "Keeping install directory."
    }
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
