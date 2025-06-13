import asyncio
import logging
import uvloop
from contextlib import asynccontextmanager
from pathlib import Path

import typer
from typing_extensions import Annotated

from flow_insight.api.fastapi_api import FastAPIInsightServer
from flow_insight.storage.snapshot.base import StorageType


async def run_server():
    """Setup and run the Flow Insight server with frontend and snapshot storage"""
    
    # Setup logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    
    # Create the FastAPI server with snapshot storage only
    server = FastAPIInsightServer(
        snapshot_storage_type=StorageType.MEMORY,
        snapshot_duration_s=60,  # Take snapshots every 1 minute
        storage_dir="/tmp/flow_insight_snapshots"
    )
    
    logger.info("Starting Flow Insight server...")
    
    # Run the server
    await server.run(host="0.0.0.0", port=8080)


@asynccontextmanager
async def lifespan():
    """Async context manager for server lifecycle"""
    try:
        yield
    finally:
        print("Server shutting down...")


def main(
    host: Annotated[str, typer.Option(help="Host to bind to")] = "0.0.0.0",
    port: Annotated[int, typer.Option(help="Port to bind to")] = 8080,
    storage_dir: Annotated[str, typer.Option(help="Directory to store snapshots")] = "/tmp/flow_insight_snapshots",
):
    """
    Flow Insight Server - Launch server with frontend and snapshot storage
    """
    
    async def run_server_with_params():
        # Setup logging
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger(__name__)
        
        # Create the FastAPI server with snapshot storage only
        server = FastAPIInsightServer(
            snapshot_storage_type=StorageType.MEMORY,
            snapshot_duration_s=60,  # Take snapshots every 1 minute
            storage_dir=storage_dir
        )
        
        logger.info(f"Starting Flow Insight server on {host}:{port}...")
        logger.info(f"Storing snapshots in: {storage_dir}")
        
        # Run the server
        await server.run(host=host, port=port)
    
    # Use uvloop for better async performance
    uvloop.install()
    asyncio.run(run_server_with_params())


if __name__ == "__main__":
    typer.run(main) 
