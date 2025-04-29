from enum import Enum
from typing import Any, Dict, Optional

import pydantic

from flow_insight.storage.persist.model import BatchNodePhysicalStats, ServicePhysicalStatsRecord
from flow_insight.storage.snapshot.model import UsageModel


class RecordType(Enum):
    CALL_SUBMIT = "call_submit"
    CALL_BEGIN = "call_begin"
    CALL_END = "call_end"
    OBJECT_GET = "object_get"
    OBJECT_PUT = "object_put"
    CONTEXT_ADD = "context_add"
    RESOURCE_USAGE_ADD = "resource_usage_add"
    DEBUGGER_INFO_ADD = "debugger_info_add"
    SERVICE_PHYSICAL_STATS_ADD = "service_physical_stats_add"
    NODE_PHYSICAL_STATS_ADD = "node_physical_stats_add"
    PROMPT_REGISTER = "prompt_register"


class CallSubmitEvent(pydantic.BaseModel):
    flow_id: str
    parent_span_id: str
    source_service: Optional[str] = None
    source_instance_id: Optional[str] = None
    source_method: str
    target_service: Optional[str] = None
    target_instance_id: Optional[str] = None
    target_method: str
    timestamp: int


class CallBeginEvent(pydantic.BaseModel):
    flow_id: str
    source_service: Optional[str] = None
    source_instance_id: Optional[str] = None
    source_method: str
    parent_span_id: str
    span_id: str


class CallEndEvent(pydantic.BaseModel):
    flow_id: str
    target_service: Optional[str] = None
    target_instance_id: Optional[str] = None
    target_method: str
    duration: float
    span_id: str


class ObjectGetEvent(pydantic.BaseModel):
    flow_id: str
    object_id: str
    receiver_service: Optional[str] = None
    receiver_instance_id: Optional[str] = None
    receiver_method: str
    timestamp: int


class ObjectPutEvent(pydantic.BaseModel):
    flow_id: str
    object_id: str
    object_size: int
    object_pos: int
    sender_service: Optional[str] = None
    sender_instance_id: Optional[str] = None
    sender_method: str
    timestamp: int


class ContextEvent(pydantic.BaseModel):
    flow_id: str
    service_name: Optional[str] = None
    instance_id: Optional[str] = None
    method_name: Optional[str] = None
    context: Dict[str, Any]


class ResourceUsageEvent(pydantic.BaseModel):
    flow_id: str
    service_name: Optional[str] = None
    instance_id: Optional[str] = None
    method_name: Optional[str] = None
    usage: Dict[str, UsageModel]


class DebuggerInfoEvent(pydantic.BaseModel):
    flow_id: str
    service_name: Optional[str] = None
    instance_id: Optional[str] = None
    method_name: Optional[str] = None
    span_id: str
    debugger_host: str
    debugger_port: int
    debugger_enabled: bool


class BatchServicePhysicalStatsEvent(pydantic.BaseModel):
    flow_id: str
    stats: list[ServicePhysicalStatsRecord]


class BatchNodePhysicalStatsEvent(pydantic.BaseModel):
    stats: BatchNodePhysicalStats


class PromptRegisterEvent(pydantic.BaseModel):
    prompt: str
