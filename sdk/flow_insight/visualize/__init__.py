"""Flow Insight Visualization Module

This module provides automatic instrumentation for Python modules to emit flow insight events.
"""

from .client import configure_insight_client
from .registry import register_module, unregister_module

__all__ = [
    "register_module",
    "unregister_module",
    "configure_insight_client",
]
