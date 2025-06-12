from enum import Enum
from typing import Any, Dict, List, Optional

import pydantic

from flow_insight.storage.persist.model import (
    Method,
    NodePhysicalStats,
    Service,
    ServicePhysicalStatsRecord,
    UsageModel,
)


class Breakpoint(pydantic.BaseModel):
    line: int
    source: str


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


class DebugSession(pydantic.BaseModel):
    service: Optional[Service] = None
    method: Method
    span_id: str


class DebugCommand(Enum):
    CONTINUE = "continue"
    PAUSE = "pause"
    STEP_OVER = "step_over"
    STEP_INTO = "step_into"
    STEP_OUT = "step_out"
    GET_THREADS = "get_threads"
    GET_STACK_TRACE = "get_stack_trace"
    SET_BREAKPOINTS = "set_breakpoints"
    EVALUATE = "evaluate"


class CallFlow(pydantic.BaseModel):
    source_id: str
    target_id: str
    count: int
    start_time: int


class DataFlow(pydantic.BaseModel):
    source_id: str
    target_id: str
    argpos: int
    duration: float
    size: float
    timestamp: int


class MethodInfo(pydantic.BaseModel):
    id: str
    method: Method
    service: Optional[Service] = None


class CallGraphData(pydantic.BaseModel):
    services: List[Service]
    methods: List[MethodInfo]
    functions: List[MethodInfo]
    callFlows: List[CallFlow]
    dataFlows: List[DataFlow]


class FlameTreeNode(pydantic.BaseModel):
    span_id: str
    id: str
    start_time: int
    end_time: int
    children: List["FlameTreeNode"]


class FlameTree(pydantic.BaseModel):
    root: FlameTreeNode


class PhysicalViewData(pydantic.BaseModel):
    services: List[ServicePhysicalStatsRecord]
    nodes: Dict[str, NodePhysicalStats]
