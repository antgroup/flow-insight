"""Client management for Flow Insight visualization."""

import os
from typing import Optional

from flow_insight import InsightClient

# Global client instance
_insight_client: Optional[InsightClient] = None


def configure_insight_client(flow_id: str, server_url: str = None) -> InsightClient:
    """Configure and return the global insight client.

    Args:
        server_url: URL for the flow insight server. If None, uses FLOW_INSIGHT_SERVER_URL env var.

    Returns:
        Configured InsightClient instance
    """
    global _insight_client

    if server_url is None:
        server_url = os.getenv("FLOW_INSIGHT_SERVER_URL", "http://localhost:8000")

    _insight_client = InsightClient(server_url, flow_id)
    return _insight_client


def get_insight_client() -> InsightClient:
    """Get the global insight client, configuring if needed."""
    global _insight_client

    if _insight_client is None:
        _insight_client = configure_insight_client()

    return _insight_client
