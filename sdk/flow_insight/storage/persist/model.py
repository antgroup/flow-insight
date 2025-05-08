from enum import Enum
from typing import Any, Dict, List, Optional

import pydantic

internal_flow_id = "_flow_insight_internal_flow_id_"


class Service(pydantic.BaseModel, frozen=True):
    service_name: str
    instance_id: str


class Method(pydantic.BaseModel, frozen=True):
    name: str


class ServiceState(str, Enum):
    RUNNING = "running"
    WAITING = "waiting"
    TERMINATED = "terminated"
    UNKNOWN = "unknown"


class MemoryInfo(pydantic.BaseModel):
    rss: int
    vms: int
    shared: int
    text: int
    lib: int
    data: int
    dirty: int


class NodeMemoryInfo(pydantic.BaseModel):
    total: int
    available: int
    used: int


class DeviceInfo(pydantic.BaseModel):
    index: int
    name: str
    uuid: str
    memory_total: int
    memory_used: int
    utilization: float


class DeviceType(str, Enum):
    GPU = "gpu"


class ServicePhysicalStats(pydantic.BaseModel):
    node_id: str
    pid: int
    state: ServiceState
    required_resources: Dict[str, float]
    placement_id: Optional[str] = None
    cpu_percent: float
    memory_info: MemoryInfo
    devices: Dict[DeviceType, List[DeviceInfo]]


class NodeResourceUsage(pydantic.BaseModel):
    total: float
    available: float


class NodePhysicalStats(pydantic.BaseModel):
    node_id: str
    devices: Dict[DeviceType, List[DeviceInfo]]
    resources: Dict[str, NodeResourceUsage]
    cpu_percent: float
    memory_info: NodeMemoryInfo


class UsageModel(pydantic.BaseModel):
    used: float
    base: str


class BatchNodePhysicalStats(pydantic.BaseModel):
    stats: List[NodePhysicalStats]


class ServicePhysicalStatsRecord(pydantic.BaseModel):
    service: Service
    stats: ServicePhysicalStats


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
    META_INFO_REGISTER = "meta_info_register"
    DRIVER_INFO_ADD = "driver_info_add"


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
    timestamp: int


class CallEndEvent(pydantic.BaseModel):
    flow_id: str
    target_service: Optional[str] = None
    target_instance_id: Optional[str] = None
    target_method: str
    duration: float
    span_id: str
    timestamp: int


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
    timestamp: int


class ResourceUsageEvent(pydantic.BaseModel):
    flow_id: str
    service_name: Optional[str] = None
    instance_id: Optional[str] = None
    method_name: Optional[str] = None
    usage: Dict[str, UsageModel]
    timestamp: int


class DebuggerInfoEvent(pydantic.BaseModel):
    flow_id: str
    service_name: Optional[str] = None
    instance_id: Optional[str] = None
    method_name: Optional[str] = None
    span_id: str
    debugger_host: str
    debugger_port: int
    debugger_enabled: bool
    timestamp: int


class BatchServicePhysicalStatsEvent(pydantic.BaseModel):
    flow_id: str
    stats: list[ServicePhysicalStatsRecord]
    timestamp: int


class BatchNodePhysicalStatsEvent(pydantic.BaseModel):
    flow_id: Optional[str] = internal_flow_id
    stats: BatchNodePhysicalStats
    timestamp: int


class MetaInfoRegisterEvent(pydantic.BaseModel):
    flow_id: Optional[str] = internal_flow_id
    prompt: str
    timestamp: int
