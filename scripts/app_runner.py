import sys
from pathlib import Path

# Add parent directory to path so we can import from the root project
parent_dir = str(Path(__file__).parent.parent)
sys.path.insert(0, parent_dir)

# Import the app from the root main.py file
from main import app  # noqa: F401, E402

# This file allows running uvicorn from the scripts directory
# while using the app defined in the root main.py file
# Usage: uvicorn app_runner:app --reload
