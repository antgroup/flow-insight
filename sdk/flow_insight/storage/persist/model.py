from typing import List

import pydantic

from flow_insight.storage.snapshot.model import NodePhysicalStats, Service, ServicePhysicalStats


class BatchNodePhysicalStats(pydantic.BaseModel):
    stats: List[NodePhysicalStats]


class ServicePhysicalStatsRecord(pydantic.BaseModel):
    service: Service
    stats: ServicePhysicalStats
