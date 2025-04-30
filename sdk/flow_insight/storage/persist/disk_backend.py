import asyncio
import json
import os
from pathlib import Path
from typing import Any, List

import aiodbm

from flow_insight.storage.persist.model import (
    BatchNodePhysicalStatsEvent,
    BatchServicePhysicalStatsEvent,
    CallBeginEvent,
    CallEndEvent,
    CallSubmitEvent,
    ContextEvent,
    DebuggerInfoEvent,
    ObjectGetEvent,
    ObjectPutEvent,
    PromptRegisterEvent,
    RecordType,
    ResourceUsageEvent,
)

# Mapping of event classes to their record types
EVENT_TYPE_MAP = {
    CallSubmitEvent: RecordType.CALL_SUBMIT.value,
    CallBeginEvent: RecordType.CALL_BEGIN.value,
    CallEndEvent: RecordType.CALL_END.value,
    ObjectGetEvent: RecordType.OBJECT_GET.value,
    ObjectPutEvent: RecordType.OBJECT_PUT.value,
    ContextEvent: RecordType.CONTEXT_ADD.value,
    ResourceUsageEvent: RecordType.RESOURCE_USAGE_ADD.value,
    DebuggerInfoEvent: RecordType.DEBUGGER_INFO_ADD.value,
    BatchServicePhysicalStatsEvent: RecordType.SERVICE_PHYSICAL_STATS_ADD.value,
    BatchNodePhysicalStatsEvent: RecordType.NODE_PHYSICAL_STATS_ADD.value,
    PromptRegisterEvent: RecordType.PROMPT_REGISTER.value,
}

REVERSE_EVENT_TYPE_MAP = {v: k for k, v in EVENT_TYPE_MAP.items()}


class DiskPersistStorageBackend:
    def __init__(self, storage_dir: str = None, flush_interval: int = 10, buffer_size: int = 1000):
        """Initialize disk-based event storage using an async key-value store.

        Args:
            storage_dir: Directory to store events. Defaults to ~/.flow_insight/events
            flush_interval: How often to flush events to disk (in seconds). Defaults to 10s
            buffer_size: Maximum events to buffer before forced flush. Defaults to 1000
        """
        if storage_dir is None:
            home_dir = os.path.expanduser("~")
            storage_dir = os.path.join(home_dir, ".flow_insight", "events")

        self._storage_dir = Path(storage_dir)
        self._storage_dir.mkdir(parents=True, exist_ok=True)

        # Main database file
        self._db_path = os.path.join(self._storage_dir, "events")
        self._db = None

        # Buffer settings
        self._flush_interval = flush_interval
        self._buffer_size = buffer_size
        self._events_buffer = []
        self._buffer_lock = asyncio.Lock()
        self._flush_task = None

        # Index for quick flow_id lookups
        self._flow_index = {}  # flow_id -> list of event keys

    async def start(self):
        """Start the background flush task and open database."""
        self._db = await aiodbm.open(self._db_path, "c")

        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._periodic_flush())

    async def stop(self):
        """Stop the background flush task and flush remaining events."""
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None

        await self._flush_events()

        if self._db:
            await self._db.close()
            self._db = None

    async def _periodic_flush(self):
        """Periodically flush events to disk."""
        while True:
            try:
                await asyncio.sleep(self._flush_interval)
                await self._flush_events()
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Error in periodic flush: {e}")

    def _get_event_type(self, event: Any) -> str:
        """Determine the event type using isinstance."""
        for event_class, record_type in EVENT_TYPE_MAP.items():
            if isinstance(event, event_class):
                return record_type
        return "_default"

    async def _flush_events(self):
        """Flush buffered events to disk."""
        async with self._buffer_lock:
            if not self._events_buffer or not self._db:
                return

            # Process each event
            for event in self._events_buffer:
                try:
                    # Create a unique key for the event
                    event_type = self._get_event_type(event)
                    timestamp_ms = event.timestamp
                    event_key = f"{event.flow_id}:{event_type}:{timestamp_ms}"

                    # Serialize the event
                    event_data = json.dumps(event.model_dump())

                    # Store in database
                    await self._db.set(event_key, event_data)

                    # Update index
                    if event.flow_id not in self._flow_index:
                        self._flow_index[event.flow_id] = []
                    self._flow_index[event.flow_id].append(event_key)

                except Exception as e:
                    print(f"Error processing event: {e}")

            # Clear buffer after flush
            self._events_buffer = []

            # Sync to ensure data is written to disk
            await self._db.sync()

    async def record_event(self, event: Any):
        """Record a time series event.

        Args:
            event: The event to record, must have a timestamp attribute.
        """
        async with self._buffer_lock:
            self._events_buffer.append(event)

            # Start flush task if not already running
            if self._flush_task is None:
                await self.start()

            # If buffer exceeds size limit, trigger a flush
            if len(self._events_buffer) >= self._buffer_size:
                asyncio.create_task(self._flush_events())

    async def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[Any]:
        """Query events within a time range.

        Args:
            flow_id: The flow ID to filter events
            start_time: Start timestamp in milliseconds
            end_time: End timestamp in milliseconds

        Returns:
            List of events matching the query
        """
        # First flush any pending events
        await self._flush_events()

        if not self._db:
            await self.start()

        results = []

        # Get all keys for this flow_id
        flow_keys = self._flow_index.get(flow_id, [])

        for key in flow_keys:
            try:
                # Extract timestamp from key
                parts = key.split(":")
                if len(parts) < 3:
                    continue

                timestamp = int(parts[2])

                # Filter by time range
                if start_time <= timestamp <= end_time:
                    # Get the event data
                    event_data = await self._db.get(key)
                    if not event_data:
                        continue

                    # Deserialize and reconstruct event
                    event_dict = json.loads(event_data)
                    event_type = parts[1]

                    # Create the appropriate event object
                    if event_type in REVERSE_EVENT_TYPE_MAP:
                        event_class = REVERSE_EVENT_TYPE_MAP[event_type]
                        event = event_class.model_validate(event_dict)
                        results.append(event)
            except Exception as e:
                print(f"Error retrieving event: {e}")

        return results

    async def clean(self):
        """Remove all stored events and reset the storage backend.

        This method:
        1. Cancels any pending flush operations
        2. Clears the in-memory buffer
        3. Closes and removes the existing database
        4. Reinitializes an empty database
        5. Clears the flow index
        """
        # Stop any background tasks and close DB
        await self.stop()

        # Clear memory buffers
        async with self._buffer_lock:
            self._events_buffer = []
            self._flow_index = {}

        # Remove the database files
        db_path = Path(self._db_path)
        extensions = [".db", ".dat", ".dir"]
        for ext in extensions:
            file_path = Path(f"{db_path}{ext}")
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception as e:
                    print(f"Error removing {file_path}: {e}")

        # Reinitialize the database
        self._db = await aiodbm.open(self._db_path, "c")
