from enum import Enum
from typing import Any, Dict, List, Optional

import pydantic


class Breakpoint(pydantic.BaseModel):
    line: int
    source: str


class Service(pydantic.BaseModel, frozen=True):
    service_name: str
    instance_id: str


class Method(pydantic.BaseModel, frozen=True):
    name: str


class ObjectInfo(pydantic.BaseModel):
    size: int
    argpos: int
    duration: float
    timestamp: int


class ObjectEvent(pydantic.BaseModel):
    sender_service: Optional[Service] = None
    sender_method: Optional[Method] = None
    object_info: ObjectInfo
    object_id: str
    timestamp: int


class Context(pydantic.BaseModel):
    service: Optional[Service] = None
    method: Optional[Method] = None
    context: Dict[str, Any]


class UsageModel(pydantic.BaseModel):
    used: float
    base: str


class ResourceUsage(pydantic.BaseModel):
    service: Optional[Service] = None
    method: Optional[Method] = None
    usage: Dict[str, UsageModel]


class DebuggerInfo(pydantic.BaseModel):
    debugger_host: str
    debugger_port: int
    debugger_enabled: bool


class CallerInfo(pydantic.BaseModel):
    service: Optional[Service] = None
    method: Optional[Method] = None


class FlameDataAggregated(pydantic.BaseModel):
    total_time: float
    call_count: int
    durations: Dict[str, float]
    service_name: str


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
