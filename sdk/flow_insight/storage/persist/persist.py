from typing import Any, List

from flow_insight.storage.persist.base import StorageType
from flow_insight.storage.persist.disk_backend import DiskPersistStorageBackend
from flow_insight.storage.persist.influxdb_backend import InfluxDBStorageBackend


class PersistStorage:
    def __init__(self, storage_type: StorageType, **storage_config):
        self._start_up = False
        if storage_type == StorageType.DISK:
            self.backend = DiskPersistStorageBackend(**storage_config)
        elif storage_type == StorageType.INFLUXDB:
            self.backend = InfluxDBStorageBackend(**storage_config)
        else:
            raise ValueError(f"Unsupported storage type: {storage_type}")

    async def record_event(self, event: Any):
        await self.backend.record_event(event)

    async def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[Any]:
        return await self.backend.query_events(flow_id, start_time, end_time)

    async def query_all_events(self) -> List[Any]:
        return await self.backend.query_all_events()

    async def get_flow_creation_time(self, flow_id: str) -> int:
        return await self.backend.get_flow_creation_time(flow_id)
