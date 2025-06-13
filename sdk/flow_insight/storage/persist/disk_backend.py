import json
import os
import asyncio
from pathlib import Path
from typing import Any, List
from concurrent.futures import ThreadPoolExecutor

import duckdb

from flow_insight.storage.persist.base import EVENT_TYPE_MAP, REVERSE_EVENT_TYPE_MAP, StorageBackend


class DiskPersistStorageBackend(StorageBackend):
    def __init__(self, storage_dir: str):
        """Initialize disk-based event storage using DuckDB.

        Args:
            storage_dir: Directory to store events. Defaults to ~/.flow_insight/events
        """
        self._storage_dir = Path(storage_dir)
        self._storage_dir.mkdir(parents=True, exist_ok=True)

        # Database file path
        self._db_path = self._storage_dir / "events.duckdb"
        self._conn = None
        self._executor = ThreadPoolExecutor(max_workers=4)

        # Cache for flow metadata
        self._flow_creation_time = {}  # flow_id -> creation time

    async def _start(self):
        """Initialize DuckDB connection and create tables."""
        if self._conn is None:
            loop = asyncio.get_event_loop()
            
            def _init_db():
                self._conn = duckdb.connect(str(self._db_path))
                
                # Create events table if it doesn't exist
                self._conn.execute("""
                    CREATE TABLE IF NOT EXISTS events (
                        flow_id VARCHAR,
                        event_type VARCHAR,
                        timestamp BIGINT,
                        event_data JSON,
                        PRIMARY KEY (flow_id, event_type, timestamp)
                    )
                """)
                
                # Create index for faster queries
                self._conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_events_flow_time 
                    ON events (flow_id, timestamp)
                """)
                
                self._conn.execute("""
                    CREATE INDEX IF NOT EXISTS idx_events_time 
                    ON events (timestamp)
                """)
                
                return True
            
            await loop.run_in_executor(self._executor, _init_db)
            await self._rebuild_flow_index()

    async def _rebuild_flow_index(self):
        """Rebuild the flow_index by scanning all events in the database."""
        if not self._conn:
            return

        loop = asyncio.get_event_loop()
        
        def _rebuild():
            # Clear existing cache
            self._flow_creation_time = {}
            
            try:
                # Get flow creation times
                result = self._conn.execute("""
                    SELECT flow_id, MIN(timestamp) as min_timestamp
                    FROM events
                    GROUP BY flow_id
                """).fetchall()
                
                print(f"Rebuilding flow index from {len(result)} flows...")
                
                for flow_id, min_timestamp in result:
                    self._flow_creation_time[flow_id] = min_timestamp
                        
                print(f"Flow index rebuilt: {len(self._flow_creation_time)} flows")
            except Exception as e:
                print(f"Error rebuilding flow index: {e}")
        
        await loop.run_in_executor(self._executor, _rebuild)

    def _get_event_type(self, event: Any) -> str:
        """Determine the event type using isinstance."""
        for event_class, record_type in EVENT_TYPE_MAP.items():
            if isinstance(event, event_class):
                return record_type
        return "_default"

    async def get_flow_creation_time(self, flow_id: str) -> int:
        """Get the creation time for a specific flow."""
        if not self._conn:
            await self._start()
        return self._flow_creation_time.get(flow_id, -1)

    async def get_flow_ids(self) -> List[str]:
        """Get all flow IDs."""
        if not self._conn:
            await self._start()
        return list(self._flow_creation_time.keys())

    async def record_event(self, event: Any):
        """Record a time series event.

        Args:
            event: The event to record, must have a timestamp attribute.
        """
        if not self._conn:
            await self._start()

        loop = asyncio.get_event_loop()
        
        def _record():
            # Update flow creation time cache
            if event.flow_id not in self._flow_creation_time:
                self._flow_creation_time[event.flow_id] = event.timestamp

            # Get event type and serialize event data
            event_type = self._get_event_type(event)
            event_data = json.dumps(event.model_dump())
            
            # Insert event into database
            self._conn.execute("""
                INSERT OR REPLACE INTO events (flow_id, event_type, timestamp, event_data)
                VALUES (?, ?, ?, ?)
            """, [event.flow_id, event_type, event.timestamp, event_data])
        
        await loop.run_in_executor(self._executor, _record)

    async def query_all_events(self) -> List[Any]:
        """Query all events.

        Returns:
            List of all events
        """
        if not self._conn:
            await self._start()

        loop = asyncio.get_event_loop()
        
        def _query_all():
            results = []
            
            try:
                # Get all events ordered by timestamp
                rows = self._conn.execute("""
                    SELECT event_type, event_data
                    FROM events
                    ORDER BY timestamp
                """).fetchall()
                
                for event_type, event_data_json in rows:
                    if event_type in REVERSE_EVENT_TYPE_MAP:
                        event_class = REVERSE_EVENT_TYPE_MAP[event_type]
                        try:
                            event_dict = json.loads(event_data_json)
                            event = event_class.model_validate(event_dict)
                            results.append(event)
                        except Exception as e:
                            print(f"Error creating event from data: {e}")
                            
            except Exception as e:
                print(f"Error querying all events: {e}")
            
            return results
        
        return await loop.run_in_executor(self._executor, _query_all)

    async def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[Any]:
        """Query events within a time range.

        Args:
            flow_id: The flow ID to filter events
            start_time: Start timestamp in milliseconds
            end_time: End timestamp in milliseconds

        Returns:
            List of events matching the query
        """
        if not self._conn:
            await self._start()

        loop = asyncio.get_event_loop()
        
        def _query():
            results = []
            
            try:
                # Query events for specific flow and time range
                rows = self._conn.execute("""
                    SELECT event_type, event_data
                    FROM events
                    WHERE flow_id = ? AND timestamp >= ? AND timestamp < ?
                    ORDER BY timestamp
                """, [flow_id, start_time, end_time]).fetchall()
                
                for event_type, event_data_json in rows:
                    if event_type in REVERSE_EVENT_TYPE_MAP:
                        event_class = REVERSE_EVENT_TYPE_MAP[event_type]
                        try:
                            event_dict = json.loads(event_data_json)
                            event = event_class.model_validate(event_dict)
                            results.append(event)
                        except Exception as e:
                            print(f"Error creating event from data: {e}")
                            
            except Exception as e:
                print(f"Error querying events: {e}")
            
            return results
        
        return await loop.run_in_executor(self._executor, _query)

    def __del__(self):
        """Cleanup resources on deletion."""
        if hasattr(self, '_executor'):
            self._executor.shutdown(wait=False)
        if hasattr(self, '_conn') and self._conn:
            self._conn.close()
