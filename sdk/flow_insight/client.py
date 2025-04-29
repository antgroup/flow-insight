from flow_insight.model import CallSubmitEvent, CallBeginEvent, CallEndEvent, ObjectGetEvent, ObjectPutEvent, RecordType, ContextEvent, ResourceUsageEvent, DebuggerInfoEvent, BatchServicePhysicalStatsEvent, BatchNodePhysicalStatsEvent, PromptRegisterEvent
from flow_insight.storage.persist.base import StorageType
from flow_insight.storage_client.http_client import HTTPStorageClient

class InsightClient:
    def __init__(self, server_url: str, storage_type: StorageType):
        if storage_type == StorageType.MEMORY:
            self._storage_client = HTTPStorageClient(server_url)
        else:
            raise ValueError(f"Unsupported storage type: {storage_type}")

    async def async_call_submit(self, call_submit: CallSubmitEvent):
        return await self._storage_client.async_emit_record(RecordType.CALL_SUBMIT, call_submit)

    async def async_call_begin(self, call_begin: CallBeginEvent):
        return await self._storage_client.async_emit_record(RecordType.CALL_BEGIN, call_begin)

    async def async_call_end(self, call_end: CallEndEvent):
        return await self._storage_client.async_emit_record(RecordType.CALL_END, call_end)

    async def async_object_get(self, object_get: ObjectGetEvent):
        return await self._storage_client.async_emit_record(RecordType.OBJECT_GET, object_get)

    async def async_object_put(self, object_put: ObjectPutEvent):
        return await self._storage_client.async_emit_record(RecordType.OBJECT_PUT, object_put)

    async def async_context(self, context: ContextEvent):
        return await self._storage_client.async_emit_record(RecordType.CONTEXT_ADD, context)

    async def async_resource_usage(self, resource_usage: ResourceUsageEvent):
        return await self._storage_client.async_emit_record(RecordType.RESOURCE_USAGE_ADD, resource_usage)

    async def async_debugger_info(self, debugger_info: DebuggerInfoEvent):
        return await self._storage_client.async_emit_record(RecordType.DEBUGGER_INFO_ADD, debugger_info)

    async def async_service_physical_stats(self, service_physical_stats: BatchServicePhysicalStatsEvent):
        return await self._storage_client.async_emit_record(RecordType.SERVICE_PHYSICAL_STATS_ADD, service_physical_stats)

    async def async_node_physical_stats(self, stats: BatchNodePhysicalStatsEvent):
        return await self._storage_client.async_emit_record(RecordType.NODE_PHYSICAL_STATS_ADD, stats)

    async def async_prompt(self, prompt: PromptRegisterEvent):
        return await self._storage_client.async_emit_record(RecordType.PROMPT_REGISTER, prompt)

    async def aclose(self):
        await self._storage_client.aclose()

    def call_submit(self, call_submit: CallSubmitEvent):
        return self._storage_client.sync_emit_record(RecordType.CALL_SUBMIT, call_submit)

    def call_begin(self, call_begin: CallBeginEvent):
        return self._storage_client.sync_emit_record(RecordType.CALL_BEGIN, call_begin)

    def call_end(self, call_end: CallEndEvent):
        return self._storage_client.sync_emit_record(RecordType.CALL_END, call_end)

    def object_get(self, object_get: ObjectGetEvent):
        return self._storage_client.sync_emit_record(RecordType.OBJECT_GET, object_get)

    def object_put(self, object_put: ObjectPutEvent):
        return self._storage_client.sync_emit_record(RecordType.OBJECT_PUT, object_put)

    def context(self, context: ContextEvent):
        return self._storage_client.sync_emit_record(RecordType.CONTEXT_ADD, context)

    def resource_usage(self, resource_usage: ResourceUsageEvent):
        return self._storage_client.sync_emit_record(RecordType.RESOURCE_USAGE_ADD, resource_usage)

    def debugger_info(self, debugger_info: DebuggerInfoEvent):
        return self._storage_client.sync_emit_record(RecordType.DEBUGGER_INFO_ADD, debugger_info)

    def service_physical_stats(self, service_physical_stats: BatchServicePhysicalStatsEvent):
        return self._storage_client.sync_emit_record(RecordType.SERVICE_PHYSICAL_STATS_ADD, service_physical_stats)

    def node_physical_stats(self, stats: BatchNodePhysicalStatsEvent):
        return self._storage_client.sync_emit_record(RecordType.NODE_PHYSICAL_STATS_ADD, stats)

    def prompt(self, prompt: PromptRegisterEvent):
        return self._storage_client.sync_emit_record(RecordType.PROMPT_REGISTER, prompt)

    def close(self):
        self._storage_client.close()
