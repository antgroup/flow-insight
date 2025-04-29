import pydantic
from typing import List
from flow_insight.storage.snapshot.model import NodePhysicalStats, ServicePhysicalStats, Service

class BatchNodePhysicalStats(pydantic.BaseModel):
    stats: List[NodePhysicalStats]

class ServicePhysicalStatsRecord(pydantic.BaseModel):
    service: Service
    stats: ServicePhysicalStats