# PowerShell script to execute reset_database.py with proper error handling

# Set variables
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogFile = Join-Path -Path $ScriptDir -ChildPath "database_reset.log"

# Display header
Write-Host "====================================================" -ForegroundColor Red
Write-Host "DATABASE RESET UTILITY" -ForegroundColor Red
Write-Host "Running at: $(Get-Date)" -ForegroundColor Red
Write-Host "====================================================" -ForegroundColor Red
Write-Host ""
Write-Host "!!! WARNING !!!" -ForegroundColor Yellow
Write-Host "This will DELETE ALL DATA in the database." -ForegroundColor Yellow
Write-Host "This action is IRREVERSIBLE." -ForegroundColor Yellow
Write-Host ""

# Confirm before proceeding
$confirmation = Read-Host "Type 'yes' to proceed or anything else to cancel"
if ($confirmation -ne "yes") {
    Write-Host "Database reset cancelled." -ForegroundColor Green
    exit 0
}

# Run the Python script
Write-Host ""
Write-Host "Starting database reset process..." -ForegroundColor Cyan
Write-Host "Log will be saved to: $LogFile" -ForegroundColor Cyan
Write-Host ""

try {
    # Execute the Python script (tee captures output to both console and log)
    Push-Location $ScriptDir
    python reset_database.py 2>&1 | Tee-Object -FilePath $LogFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Database reset completed successfully." -ForegroundColor Green
        Write-Host "You can now register new users with the application." -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "Database reset failed with exit code $LASTEXITCODE" -ForegroundColor Red
        Write-Host "Check $LogFile for details" -ForegroundColor Red
    }
    Pop-Location
}
catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Script execution failed. See $LogFile for details." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Start or restart your application" -ForegroundColor White
Write-Host "2. Register a new admin user" -ForegroundColor White
Write-Host "3. Begin using the system with a clean database" -ForegroundColor White
Write-Host "====================================================" -ForegroundColor Cyan
