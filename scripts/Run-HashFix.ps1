# PowerShell script to execute fix_invalid_hashes.py and log the results
# This addresses the "Invalid password hash format" errors in the authentication system

# Set variables
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path -Path (Split-Path -Parent $ScriptDir) -ChildPath "logs"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$LogFile = Join-Path -Path $LogDir -ChildPath "hash_fix_$Timestamp.log"

# Ensure log directory exists
if (-not (Test-Path -Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# Display header
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Password Hash Fix Utility" -ForegroundColor Cyan
Write-Host "Running at: $(Get-Date)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

# Run the script and capture output to log file
Write-Host "Running hash fix script. This may take a few minutes..." -ForegroundColor Yellow
Write-Host "Log file will be saved to: $LogFile" -ForegroundColor Yellow
Write-Host ""

# Execute the script and tee output to both console and log file
try {
    Push-Location $ScriptDir
    python fix_invalid_hashes.py 2>&1 | Tee-Object -FilePath $LogFile
    Pop-Location
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Script execution failed. Please check the Python environment and try again." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Completed at: $(Get-Date)" -ForegroundColor Cyan
Write-Host "Check $LogFile for complete details" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

# Display a summary if available
if (Test-Path -Path $LogFile) {
    Write-Host ""
    Write-Host "Summary of affected users:" -ForegroundColor Green
    
    # PowerShell equivalent of grep for finding summary information
    $SummaryLines = Get-Content -Path $LogFile | Select-String -Pattern "Found.*users with invalid hashes" -Context 0,1
    if ($SummaryLines) {
        $SummaryLines | ForEach-Object { Write-Host $_.Line -ForegroundColor White }
    } else {
        Write-Host "No summary information found in log." -ForegroundColor Yellow
    }
    
    # Check if any CSV reports were generated
    $CsvReports = Get-ChildItem -Path $ScriptDir -Filter "invalid_hash_report_*.csv" -ErrorAction SilentlyContinue
    if ($CsvReports) {
        Write-Host ""
        Write-Host "CSV Reports generated:" -ForegroundColor Green
        $CsvReports | ForEach-Object { Write-Host $_.FullName -ForegroundColor White }
    }
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "1. Affected users will be prompted to reset their passwords" -ForegroundColor White
Write-Host "2. Review CSV reports (if any) for a list of affected accounts" -ForegroundColor White
Write-Host "3. Monitor auth logs for any remaining password hash issues" -ForegroundColor White
Write-Host ""
