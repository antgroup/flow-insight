from flow_insight.model import (
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
from flow_insight.storage.persist.base import StorageType
from flow_insight.storage_client.http_client import HTTPStorageClient


class InsightClient:
    def __init__(self, server_url: str, storage_type: StorageType):
        if storage_type == StorageType.MEMORY:
            self._storage_client = HTTPStorageClient(server_url)
        else:
            raise ValueError(f"Unsupported storage type: {storage_type}")

    async def async_emit_event(self, event: any):
        if isinstance(event, CallSubmitEvent):
            return await self._storage_client.async_emit_record(RecordType.CALL_SUBMIT, event)
        elif isinstance(event, CallBeginEvent):
            return await self._storage_client.async_emit_record(RecordType.CALL_BEGIN, event)
        elif isinstance(event, CallEndEvent):
            return await self._storage_client.async_emit_record(RecordType.CALL_END, event)
        elif isinstance(event, ObjectGetEvent):
            return await self._storage_client.async_emit_record(RecordType.OBJECT_GET, event)
        elif isinstance(event, ObjectPutEvent):
            return await self._storage_client.async_emit_record(RecordType.OBJECT_PUT, event)
        elif isinstance(event, ContextEvent):
            return await self._storage_client.async_emit_record(RecordType.CONTEXT_ADD, event)
        elif isinstance(event, ResourceUsageEvent):
            return await self._storage_client.async_emit_record(
                RecordType.RESOURCE_USAGE_ADD, event
            )
        elif isinstance(event, DebuggerInfoEvent):
            return await self._storage_client.async_emit_record(RecordType.DEBUGGER_INFO_ADD, event)
        elif isinstance(event, BatchServicePhysicalStatsEvent):
            return await self._storage_client.async_emit_record(
                RecordType.SERVICE_PHYSICAL_STATS_ADD, event
            )
        elif isinstance(event, BatchNodePhysicalStatsEvent):
            return await self._storage_client.async_emit_record(
                RecordType.NODE_PHYSICAL_STATS_ADD, event
            )
        elif isinstance(event, PromptRegisterEvent):
            return await self._storage_client.async_emit_record(RecordType.PROMPT_REGISTER, event)
        else:
            raise ValueError(f"Unsupported event type: {type(event)}")

    async def aclose(self):
        await self._storage_client.aclose()

    def emit_event(self, event: any):
        if isinstance(event, CallSubmitEvent):
            return self._storage_client.sync_emit_record(RecordType.CALL_SUBMIT, event)
        elif isinstance(event, CallBeginEvent):
            return self._storage_client.sync_emit_record(RecordType.CALL_BEGIN, event)
        elif isinstance(event, CallEndEvent):
            return self._storage_client.sync_emit_record(RecordType.CALL_END, event)
        elif isinstance(event, ObjectGetEvent):
            return self._storage_client.sync_emit_record(RecordType.OBJECT_GET, event)
        elif isinstance(event, ObjectPutEvent):
            return self._storage_client.sync_emit_record(RecordType.OBJECT_PUT, event)
        elif isinstance(event, ContextEvent):
            return self._storage_client.sync_emit_record(RecordType.CONTEXT_ADD, event)
        elif isinstance(event, ResourceUsageEvent):
            return self._storage_client.sync_emit_record(RecordType.RESOURCE_USAGE_ADD, event)
        elif isinstance(event, DebuggerInfoEvent):
            return self._storage_client.sync_emit_record(RecordType.DEBUGGER_INFO_ADD, event)
        elif isinstance(event, BatchServicePhysicalStatsEvent):
            return self._storage_client.sync_emit_record(
                RecordType.SERVICE_PHYSICAL_STATS_ADD, event
            )
        elif isinstance(event, BatchNodePhysicalStatsEvent):
            return self._storage_client.sync_emit_record(RecordType.NODE_PHYSICAL_STATS_ADD, event)
        elif isinstance(event, PromptRegisterEvent):
            return self._storage_client.sync_emit_record(RecordType.PROMPT_REGISTER, event)
        else:
            raise ValueError(f"Unsupported event type: {type(event)}")

    def close(self):
        self._storage_client.close()
