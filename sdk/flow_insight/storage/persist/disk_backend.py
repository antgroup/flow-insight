import json
import os
from pathlib import Path
from typing import Any, List

import aiodbm

from flow_insight.storage.persist.base import EVENT_TYPE_MAP, REVERSE_EVENT_TYPE_MAP, StorageBackend


class DiskPersistStorageBackend(StorageBackend):
    def __init__(self, storage_dir: str):
        """Initialize disk-based event storage using an async key-value store.

        Args:
            storage_dir: Directory to store events. Defaults to ~/.flow_insight/events
        """
        self._storage_dir = Path(storage_dir)
        self._storage_dir.mkdir(parents=True, exist_ok=True)

        # Main database file
        self._db_path = os.path.join(self._storage_dir, "events.db")
        self._db = None

        # Index for quick flow_id lookups - will be rebuilt from DB during start()
        self._flow_index = {}  # flow_id -> list of event keys
        self._flow_creation_time = {}  # flow_id -> creation time

    async def _start(self):
        """Open database and rebuild flow_index from stored events."""
        self._db = await aiodbm.open(self._db_path, "c")

        # Clear the index and rebuild it from the database
        self._flow_index = {}
        await self._rebuild_flow_index()

    async def _rebuild_flow_index(self):
        """Rebuild the flow_index by scanning all keys in the database."""
        if not self._db:
            return

        for key in await self._db.keys():
            try:
                key_str = key.decode("utf-8")

                parts = key_str.split(":")
                if len(parts) >= 3:
                    flow_id = parts[0]

                    if flow_id not in self._flow_creation_time:
                        self._flow_creation_time[flow_id] = int(parts[2])

                    if flow_id not in self._flow_index:
                        self._flow_index[flow_id] = []
                    self._flow_index[flow_id].append(key_str)
            except Exception as e:
                print(f"Error rebuilding flow index for key {key}: {e}")

        for flow_id in self._flow_index:
            self._flow_index[flow_id] = sorted(
                self._flow_index[flow_id], key=lambda x: int(x.split(":")[2])
            )

    def _get_event_type(self, event: Any) -> str:
        """Determine the event type using isinstance."""
        for event_class, record_type in EVENT_TYPE_MAP.items():
            if isinstance(event, event_class):
                return record_type
        return "_default"

    async def get_flow_creation_time(self, flow_id: str) -> int:
        return self._flow_creation_time.get(flow_id, -1)

    async def get_flow_ids(self) -> List[str]:
        return list(self._flow_creation_time.keys())

    async def record_event(self, event: Any):
        """Record a time series event.

        Args:
            event: The event to record, must have a timestamp attribute.
        """
        if not self._db:
            await self._start()

        if event.flow_id not in self._flow_creation_time:
            self._flow_creation_time[event.flow_id] = event.timestamp

        # Create a unique key for the event
        event_type = self._get_event_type(event)
        timestamp_ms = event.timestamp
        event_key = f"{event.flow_id}:{event_type}:{timestamp_ms}"

        # Serialize the event
        event_data = json.dumps(event.model_dump())

        # Store in database
        await self._db.set(event_key, event_data)
        await self._db.sync()

        # Update index
        if event.flow_id not in self._flow_index:
            self._flow_index[event.flow_id] = []
        self._flow_index[event.flow_id].append(event_key)

    async def query_all_events(self) -> List[Any]:
        """Query all events.

        Returns:
            List of all events
        """
        if not self._db:
            await self._start()

        results = []
        for key in await self._db.keys():
            key_str = key.decode("utf-8")

            parts = key_str.split(":")
            if len(parts) < 3:
                continue

            event_data = await self._db.get(key)
            if not event_data:
                continue

            event_dict = json.loads(event_data.decode("utf-8"))
            event_type = parts[1]

            if event_type in REVERSE_EVENT_TYPE_MAP:
                event_class = REVERSE_EVENT_TYPE_MAP[event_type]
                event = event_class.model_validate(event_dict)
                results.append(event)

        return sorted(results, key=lambda x: x.timestamp)

    async def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[Any]:
        """Query events within a time range.

        Args:
            flow_id: The flow ID to filter events
            start_time: Start timestamp in milliseconds
            end_time: End timestamp in milliseconds

        Returns:
            List of events matching the query
        """
        if not self._db:
            await self._start()

        results = []

        # Get all keys for this flow_id
        flow_keys = self._flow_index.get(flow_id, [])

        for key in flow_keys:
            try:
                parts = key.split(":")
                if len(parts) < 3:
                    continue

                timestamp = int(parts[2])

                if start_time <= timestamp < end_time:
                    event_data = await self._db.get(key)
                    if not event_data:
                        continue

                    event_dict = json.loads(event_data.decode("utf-8"))
                    event_type = parts[1]

                    if event_type in REVERSE_EVENT_TYPE_MAP:
                        event_class = REVERSE_EVENT_TYPE_MAP[event_type]
                        event = event_class.model_validate(event_dict)
                        results.append(event)
            except Exception as e:
                print(f"Error retrieving event: {e}")

        return results
