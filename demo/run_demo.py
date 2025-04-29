#!/usr/bin/env python3
"""
Flow Insight Demo Launcher
--------------------------
This script launches the Flow Insight demo environment with a server and client.
"""
import os
import sys
import subprocess
from pathlib import Path

def main():
    # Get the absolute path to the demo directory
    demo_dir = Path(__file__).parent.absolute()
    
    # Print welcome message
    print("=" * 80)
    print(" Flow Insight Demo Environment ")
    print("=" * 80)
    print("Starting Flow Insight demo server...")
    print("The web interface will be available at http://localhost:8000")
    print("Press Ctrl+C to stop the demo.")
    print("=" * 80)
    
    # Launch the demo server
    demo_server_path = demo_dir / "demo_server.py"
    subprocess.run([sys.executable, str(demo_server_path)], check=True)

if __name__ == "__main__":
    main() 