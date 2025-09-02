"""
Command Line Interface for Flow Insight

Provides a simple way to start the Flow Insight server from the command line.
"""

import argparse
import os
import sys

from .api.fastapi_api import create_app


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Flow Insight - Distributed application monitoring and visualization tool"
    )

    parser.add_argument("command", choices=["run", "serve", "start"], help="Command to execute")

    parser.add_argument(
        "--host", default="localhost", help="Host to bind the server to (default: localhost)"
    )

    parser.add_argument(
        "--port", type=int, default=8000, help="Port to bind the server to (default: 8000)"
    )

    parser.add_argument("--reload", action="store_true", help="Enable auto-reload for development")

    parser.add_argument(
        "--workers", type=int, default=1, help="Number of worker processes (default: 1)"
    )

    args = parser.parse_args()

    os.environ["RAY_FLOW_INSIGHT_FRONTEND"] = "1"

    if args.command in ["run", "serve", "start"]:
        try:
            import uvicorn

            app = create_app()

            print(f"Starting Flow Insight server on {args.host}:{args.port}")
            print(f"Access the dashboard at: http://{args.host}:{args.port}")
            print("Press Ctrl+C to stop the server")

            uvicorn.run(
                app,
                host=args.host,
                port=args.port,
                reload=args.reload,
                workers=args.workers if not args.reload else 1,
            )

        except ImportError:
            print("Error: uvicorn is required to run the server.")
            print("Install with: pip install uvicorn")
            sys.exit(1)
        except Exception as e:
            print(f"Error starting server: {e}")
            sys.exit(1)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
