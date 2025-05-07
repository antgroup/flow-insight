from pydantic import BaseModel

from flow_insight import RecordType


class StorageClient:
    def __init__(self):
        pass

    async def async_ping(self):
        pass

    def sync_ping(self):
        pass

    async def async_emit_record(self, record_type: RecordType, record: BaseModel):
        pass

    def sync_emit_record(self, record_type: RecordType, record: BaseModel):
        pass

    async def aclose(self):
        pass

    def close(self):
        pass
