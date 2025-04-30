from typing import Any, List

from flow_insight.storage.persist.base import StorageType
from flow_insight.storage.persist.disk_backend import DiskPersistStorageBackend


class PersistStorage:
    def __init__(self, storage_type: StorageType):
        self._start_up = False
        if storage_type == StorageType.DISK:
            self.backend = DiskPersistStorageBackend()
        else:
            raise ValueError(f"Unsupported storage type: {storage_type}")

    async def record_event(self, event: Any):
        if not self._start_up:
            self._start_up = True
            await self.backend.clean()
        await self.backend.record_event(event)

    async def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[Any]:
        return await self.backend.query_events(flow_id, start_time, end_time)

    async def clean(self):
        await self.backend.clean()
