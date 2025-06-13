import asyncio
import sys
import logging
import argparse
from pathlib import Path
from typing import Optional

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from flow_insight import FastAPIInsightServer
from flow_insight.storage.snapshot.base import StorageType as SnapshotStorageType
from flow_insight.storage.persist.base import StorageType as PersistStorageType

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

HOST = "0.0.0.0"
PORT = 8000

async def setup_and_run_server(frontend_dir: Optional[str] = None, storage_dir: Optional[str] = None, port: int = PORT):
    """Setup and run the Flow Insight server with frontend and disk persistence"""
    
    # Set default storage directory
    if storage_dir is None:
        storage_dir = ".flow_insight/events"
    
    # Create the FastAPI server with disk persistence
    server = FastAPIInsightServer(
        snapshot_storage_type=SnapshotStorageType.MEMORY, 
        persist_storage_type=PersistStorageType.DISK, 
        storage_dir=storage_dir
    )
    
    # Mount the frontend static files
    if frontend_dir:
        frontend_path = Path(frontend_dir)
    else:
        # Default frontend directory
        frontend_path = Path(__file__).parent.parent / "frontend" / "example" / "dist"
    
    if frontend_path.exists():
        server.app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")
        logger.info(f"Frontend mounted from: {frontend_path}")
    else:
        logger.warning(f"Frontend directory not found at {frontend_path}")
        logger.info("Server will run without frontend mounting")
    
    # Add CORS middleware
    server.app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    logger.info(f"Storage directory: {storage_dir}")
    logger.info(f"Server starting at http://{HOST}:{port}")
    
    # Run the server
    await server.run(host=HOST, port=port)

def main():
    """Main function with argument parsing"""
    parser = argparse.ArgumentParser(
        description="Flow Insight Server - Launch server with frontend and disk persistence"
    )
    parser.add_argument(
        "--frontend", 
        type=str, 
        help="Path to frontend directory (default: ../frontend/example/dist)"
    )
    parser.add_argument(
        "--storage", 
        type=str, 
        help="Path to storage directory (default: .flow_insight/events)"
    )
    parser.add_argument(
        "--port", 
        type=int, 
        default=PORT, 
        help=f"Port to run server on (default: {PORT})"
    )
    
    args = parser.parse_args()
    
    # Print welcome message
    print("=" * 80)
    print(" Flow Insight Server ")
    print("=" * 80)
    print("Starting Flow Insight server...")
    print(f"Web interface: http://localhost:{args.port}")
    print(f"Frontend directory: {args.frontend or 'default'}")
    print(f"Storage directory: {args.storage or 'default'}")
    print("Press Ctrl+C to stop the server.")
    print("=" * 80)
    
    try:
        asyncio.run(setup_and_run_server(args.frontend, args.storage, args.port))
    except KeyboardInterrupt:
        print("\nServer stopped by user.")
        logger.info("Server stopped by user")
    except Exception as e:
        print(f"Server error: {str(e)}")
        logger.error(f"Server error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main() 
