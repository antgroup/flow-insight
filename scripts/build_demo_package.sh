#!/bin/bash

# Flow Insight Demo Package Builder
# This script builds the frontend and packages the demo server with frontend assets

set -e  # Exit on any error

SCRIPT_DIR="$(pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend/example"
DEMO_DIR="$SCRIPT_DIR/demo"
BUILD_DIR="$SCRIPT_DIR/build"
PACKAGE_NAME="flow-insight-demo"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PACKAGE_DIR="$BUILD_DIR/${PACKAGE_NAME}_${TIMESTAMP}"

echo "=================================="
echo " Flow Insight Demo Package Builder"
echo "=================================="
echo "Building frontend and packaging demo..."
echo "Build directory: $PACKAGE_DIR"
echo "=================================="

# Clean and create build directory
echo "📁 Creating build directory..."
rm -rf "$BUILD_DIR"
mkdir -p "$PACKAGE_DIR"

# Check if frontend directory exists
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "❌ Frontend directory not found: $FRONTEND_DIR"
    exit 1
fi

# Check if demo server exists
if [ ! -f "$DEMO_DIR/demo_server.py" ]; then
    echo "❌ Demo server not found: $DEMO_DIR/demo_server.py"
    exit 1
fi

# Build frontend
echo "🔨 Building frontend..."
cd "$FRONTEND_DIR"

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

# Build the frontend
echo "🏗️ Running frontend build..."
npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
    echo "❌ Frontend build failed - dist directory not found"
    exit 1
fi

echo "✅ Frontend build completed successfully"

# Copy demo server
echo "📄 Copying demo server..."
cp "$DEMO_DIR/demo_server.py" "$PACKAGE_DIR/"

# Copy frontend assets
echo "📁 Copying frontend assets..."
cp -r "$FRONTEND_DIR/dist" "$PACKAGE_DIR/frontend"

# Create startup script
echo "📝 Creating startup script..."
cat > "$PACKAGE_DIR/start_demo.sh" << 'EOF'
#!/bin/bash

# Flow Insight Demo Startup Script
echo "=================================="
echo " Flow Insight Demo Server"
echo "=================================="
echo "Starting Flow Insight demo server..."
echo "Web interface will be available at http://localhost:8000"
echo "Press Ctrl+C to stop the server."
echo "=================================="

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "❌ Python is not installed or not in PATH"
        echo "Please install Python 3.7+ to run the demo server"
        exit 1
    else
        PYTHON_CMD="python"
    fi
else
    PYTHON_CMD="python3"
fi

echo "Using Python: $PYTHON_CMD"

# Check if required modules are available
$PYTHON_CMD -c "import flow_insight" 2>/dev/null || {
    echo "❌ flow_insight module not found"
    echo "Please install flow_insight package first:"
    echo "pip install flow_insight"
    exit 1
}

# Start the demo server with the bundled frontend
cd "$SCRIPT_DIR"
exec $PYTHON_CMD demo_server.py --frontend frontend "$@"
EOF

# Make startup script executable
chmod +x "$PACKAGE_DIR/start_demo.sh"

# Create Windows batch file
echo "📝 Creating Windows startup script..."
cat > "$PACKAGE_DIR/start_demo.bat" << 'EOF'
@echo off
echo ==================================
echo  Flow Insight Demo Server
echo ==================================
echo Starting Flow Insight demo server...
echo Web interface will be available at http://localhost:8000
echo Press Ctrl+C to stop the server.
echo ==================================

REM Check if Python is available
python --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python 3.7+ to run the demo server
    pause
    exit /b 1
)

REM Check if required modules are available
python -c "import flow_insight" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: flow_insight module not found
    echo Please install flow_insight package first:
    echo pip install flow_insight
    pause
    exit /b 1
)

REM Start the demo server with the bundled frontend
python demo_server.py --frontend frontend %*
pause
EOF

# Create README
echo "📝 Creating README..."
cat > "$PACKAGE_DIR/README.md" << 'EOF'
# Flow Insight Demo Package

This package contains a pre-built Flow Insight demo server with frontend assets.

## Requirements

- Python 3.7+
- flow_insight package installed (`pip install flow_insight`)

## Quick Start

### Linux/macOS
```bash
./start_demo.sh
```

### Windows
```cmd
start_demo.bat
```

### Manual Start
```bash
python demo_server.py --frontend frontend
```

## Options

You can pass additional options to the demo server:

```bash
# Custom port
./start_demo.sh --port 9000

# Custom storage directory
./start_demo.sh --storage /path/to/storage

# Help
./start_demo.sh --help
```

## Access

Once started, the web interface will be available at:
http://localhost:8000

## Stopping

Press `Ctrl+C` in the terminal to stop the server.

## Package Contents

- `demo_server.py` - The main demo server
- `frontend/` - Pre-built frontend assets
- `start_demo.sh` - Linux/macOS startup script
- `start_demo.bat` - Windows startup script
- `README.md` - This file

## Troubleshooting

1. **Python not found**: Make sure Python 3.7+ is installed and in your PATH
2. **flow_insight module not found**: Install with `pip install flow_insight`
3. **Port already in use**: Use `--port` option to specify a different port
4. **Permission denied on startup script**: Run `chmod +x start_demo.sh`

For more information, visit: https://github.com/your-org/flow-insight
EOF

# Create zip package
echo "📦 Creating zip package..."
cd "$BUILD_DIR"
ZIP_NAME="${PACKAGE_NAME}_${TIMESTAMP}.zip"
zip -r "$ZIP_NAME" "$(basename "$PACKAGE_DIR")"

# Move zip to script directory and clean up build directory
echo "🧹 Moving zip to script directory and cleaning up..."
mv "$ZIP_NAME" "$SCRIPT_DIR/"
cd "$SCRIPT_DIR"
rm -rf "$BUILD_DIR"

echo ""
echo "✅ Package created successfully!"
echo "📦 Package location: $SCRIPT_DIR/$ZIP_NAME"
echo ""
echo "To test the package:"
echo "1. Extract: unzip $ZIP_NAME"
echo "2. Run: cd $(basename "$PACKAGE_DIR") && ./start_demo.sh"
echo ""
echo "🎉 Demo package ready for distribution!" 