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
  
  echo "Auto-fixing ESLint issues..."
  npm run lint:fix
  
  echo "Auto-formatting with Prettier..."
  npm run format
  
  echo "Running TypeScript type check..."
  npm run type-check
else
  echo "Running in check-only mode..."
  
  echo "Running ESLint..."
  npm run lint
  
  echo "Running Prettier formatting check..."
  npx prettier --check 'src/**/*.{js,jsx,ts,tsx,css,md,json}'
  
  echo "Running TypeScript type check..."
  npm run type-check
fi

echo "All frontend linting checks completed successfully!"
echo ""
echo "TIP: Run './lint.sh --fix' to automatically fix formatting issues." 