from enum import Enum
from typing import List

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


class StorageType(Enum):
    DISK = "disk"
    INFLUXDB = "influxdb"


class StorageClient:
    def __init__(self):
        pass

    def get_flow_creation_time(self, flow_id: str) -> int:
        pass

    def record_event(self, event: any):
        pass

    def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[any]:
        pass

    def query_all_events(self) -> List[any]:
        pass


class StorageBackend:
    def __init__(self):
        pass
