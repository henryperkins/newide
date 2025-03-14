#!/bin/bash
# Script to execute fix_invalid_hashes.py and log the results
# This addresses the "Invalid password hash format" errors in the authentication system

# Set variables
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
LOG_DIR="../logs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="$LOG_DIR/hash_fix_$TIMESTAMP.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Display header
echo "===================================================="
echo "Password Hash Fix Utility"
echo "Running at: $(date)"
echo "===================================================="
echo ""

# Run the script and capture output to log file
echo "Running hash fix script. This may take a few minutes..."
echo "Log file will be saved to: $LOG_FILE"
echo ""

# Execute the script and tee output to both console and log file
cd "$SCRIPT_DIR" && python fix_invalid_hashes.py 2>&1 | tee "$LOG_FILE"

echo ""
echo "===================================================="
echo "Completed at: $(date)"
echo "Check $LOG_FILE for complete details"
echo "===================================================="

# Display a summary if available
if [ -f "$LOG_FILE" ]; then
  echo ""
  echo "Summary of affected users:"
  grep -A 1 "Found.*users with invalid hashes" "$LOG_FILE"
  
  # Check if any CSV reports were generated
  CSV_REPORTS=$(ls -1 invalid_hash_report_*.csv 2>/dev/null)
  if [ -n "$CSV_REPORTS" ]; then
    echo ""
    echo "CSV Reports generated:"
    echo "$CSV_REPORTS"
  fi
fi

echo ""
echo "Next steps:"
echo "1. Affected users will be prompted to reset their passwords"
echo "2. Review CSV reports (if any) for a list of affected accounts"
echo "3. Monitor auth logs for any remaining password hash issues"
echo ""
