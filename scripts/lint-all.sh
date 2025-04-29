#!/bin/bash
set -e

# Check if the --fix flag was provided
FIX_MODE="--check"
for arg in "$@"; do
  if [ "$arg" == "--fix" ]; then
    FIX_MODE="--fix"
    break
  fi
done

echo "===================================================================="
echo "                  Flow Insight Linting Script                       "
echo "===================================================================="

if [ "$FIX_MODE" == "--fix" ]; then
  echo "Running in auto-fix mode"
else
  echo "Running in check-only mode"
fi
echo "--------------------------------------------------------------------"

echo ""
echo "Running backend (Python) linting..."
echo "--------------------------------------------------------------------"
cd sdk
./lint.sh $FIX_MODE
cd ..

echo ""
echo "Running frontend (React/TypeScript) linting..."
echo "--------------------------------------------------------------------"
cd frontend
./lint.sh $FIX_MODE
cd ..

echo ""
echo "===================================================================="
echo "All linting checks completed successfully!"
echo "===================================================================="
echo ""
echo "TIP: Run './lint-all.sh --fix' to automatically fix formatting issues." 