#!/bin/bash
set -e

# Check if the --fix flag was provided
FIX_MODE=false
for arg in "$@"; do
  if [ "$arg" == "--fix" ]; then
    FIX_MODE=true
    break
  fi
done

if [ "$FIX_MODE" == true ]; then
  echo "Running in auto-fix mode..."
  
  echo "Auto-formatting imports with isort..."
  python -m isort flow_insight
  
  echo "Auto-formatting code with black..."
  python -m black flow_insight
  
  echo "Running flake8 linter (check only)..."
  python -m flake8 flow_insight
  
else
  echo "Running in check-only mode..."
  
  echo "Checking imports with isort..."
  python -m isort --check-only flow_insight
  
  echo "Checking formatting with black..."
  python -m black --check flow_insight
  
  echo "Running flake8 linter..."
  python -m flake8 flow_insight
  
fi

echo "All linting checks completed successfully!"
echo ""
echo "TIP: Run './lint.sh --fix' to automatically fix formatting issues." 
