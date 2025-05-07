import time
from collections import defaultdict
from typing import Any, Dict, List

import httpx

from flow_insight.storage.persist.base import REVERSE_EVENT_TYPE_MAP, StorageBackend
from flow_insight.storage.persist.model import RecordType


class InfluxDBStorageBackend(StorageBackend):
    def __init__(self, server_url: str, username: str = None, password: str = None):
        """Initialize the storage backend to work with InfluxDB.

        Args:
            server_url: The URL of the InfluxDB server
            username: Optional username for authentication
            password: Optional password for authentication
        """
        self.server_url = server_url.rstrip("/")
        self.client = httpx.AsyncClient(timeout=30.0)
        self.db_name = "flow_insight"  # Default database name
        self.username = username
        self.password = password
        self._flow_creation_times = {}  # flow_id -> creation time

    async def _create_database_if_not_exists(self):
        """Create the InfluxDB database if it doesn't exist."""
        try:
            # First check if database exists
            query = "SHOW DATABASES"
            params = {"q": query}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password

            result = await self.client.get(f"{self.server_url}/query", params=params)
            result.raise_for_status()
            data = result.json()

            # Check if database already exists
            db_exists = False
            if data.get("results") and data["results"][0].get("series"):
                for series in data["results"][0]["series"]:
                    for values in series.get("values", []):
                        if values and values[0] == self.db_name:
                            db_exists = True
                            break

            # Create database if it doesn't exist
            if not db_exists:
                query = f"CREATE DATABASE {self.db_name}"
                params = {"q": query}
                if self.username and self.password:
                    params["u"] = self.username
                    params["p"] = self.password

                result = await self.client.get(f"{self.server_url}/query", params=params)
                result.raise_for_status()

            # Check if the flow_insight retention policy exists
            query = f"SHOW RETENTION POLICIES ON {self.db_name}"
            params = {"q": query}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password

            result = await self.client.get(f"{self.server_url}/query", params=params)
            result.raise_for_status()
            data = result.json()

            # Check if the flow_insight retention policy exists
            rp_exists = False
            if data.get("results") and data["results"][0].get("series"):
                for series in data["results"][0]["series"]:
                    if series.get("values"):
                        for row in series.get("values", []):
                            # First column is name of retention policy
                            if row and row[0] == "flow_insight":
                                rp_exists = True
                                break

            # Create retention policy if it doesn't exist
            if not rp_exists:
                # Create with infinite retention and make it default
                query = (
                    f"CREATE RETENTION POLICY flow_insight "
                    f"ON {self.db_name} DURATION INF REPLICATION 1 DEFAULT"
                )
                params = {"q": query}
                if self.username and self.password:
                    params["u"] = self.username
                    params["p"] = self.password

                result = await self.client.get(f"{self.server_url}/query", params=params)
                result.raise_for_status()

        except Exception as e:
            print(f"Error creating database or retention policy: {e}")

    async def _start(self):
        """Initialize the connection and build flow creation times from database."""
        try:
            # Ensure database exists
            await self._create_database_if_not_exists()

            # Build the flow creation times by querying the earliest timestamp for each flow_id
            # Add back the flow_insight prefix to the measurement name
            query = 'SELECT first(count) as creation_time FROM "flow_insight.call" GROUP BY flow_id'

            params = {"q": query, "db": self.db_name, "epoch": "ms"}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password

            result = await self.client.get(f"{self.server_url}/query", params=params)
            result.raise_for_status()
            data = result.json()

            if data.get("results") and data["results"][0].get("series"):
                for series in data["results"][0]["series"]:
                    tags = series.get("tags", {})
                    flow_id = tags.get("flow_id")

                    if flow_id and series.get("values") and len(series["values"][0]) > 1:
                        creation_time = series["values"][0][0]
                        if creation_time:
                            self._flow_creation_times[flow_id] = creation_time
        except Exception as e:
            print(f"Error initializing InfluxDB connection: {e}")

    async def get_flow_creation_time(self, flow_id: str) -> int:
        """Get the creation time of a flow.

        Args:
            flow_id: The flow ID to get the creation time for

        Returns:
            The creation time in milliseconds, or -1 if not found
        """
        # If we don't have the creation time yet, initialize the connection
        if not self._flow_creation_times and flow_id not in self._flow_creation_times:
            await self._start()

        return self._flow_creation_times.get(flow_id, -1)

    async def query_events(self, flow_id: str, start_time: int, end_time: int) -> List[Any]:
        """Query events for a specific flow within a time range using InfluxDB.

        Args:
            flow_id: Flow ID to query events for
            start_time: Start time in milliseconds
            end_time: End time in milliseconds

        Returns:
            List of reconstructed events
        """
        # Initialize the connection if needed
        if not self._flow_creation_times:
            await self._start()

        results = []

        # Define all measurements to query for each record type
        measurements_by_type = {
            RecordType.CALL_SUBMIT: ["flow_insight.call"],
            RecordType.CALL_BEGIN: ["flow_insight.call"],
            RecordType.CALL_END: ["flow_insight.call"],
            RecordType.OBJECT_GET: ["flow_insight.object"],
            RecordType.OBJECT_PUT: ["flow_insight.object"],
            RecordType.CONTEXT_ADD: ["flow_insight.context"],
            RecordType.RESOURCE_USAGE_ADD: ["flow_insight.resource"],
            RecordType.DEBUGGER_INFO_ADD: ["flow_insight.debugger"],
            RecordType.SERVICE_PHYSICAL_STATS_ADD: [
                "flow_insight.service.cpu",
                "flow_insight.service.memory.rss",
                "flow_insight.service.memory.vms",
                "flow_insight.service.memory.shared",
                "flow_insight.service.memory.text",
                "flow_insight.service.memory.lib",
                "flow_insight.service.memory.data",
                "flow_insight.service.memory.dirty",
                "flow_insight.service.gpu.memory",
                "flow_insight.service.gpu.memory_total",
                "flow_insight.service.gpu.utilization",
                "flow_insight.service.required_resource",
            ],
            RecordType.NODE_PHYSICAL_STATS_ADD: [
                "flow_insight.node.cpu",
                "flow_insight.node.memory.total",
                "flow_insight.node.memory.available",
                "flow_insight.node.memory.used",
                "flow_insight.node.gpu.memory",
                "flow_insight.node.gpu.memory_total",
                "flow_insight.node.gpu.utilization",
                "flow_insight.resource.total",
                "flow_insight.resource.available",
            ],
            RecordType.PROMPT_REGISTER: ["flow_insight.prompt"],
        }
        start_time_ns = start_time * 1_000_000  # Convert ms to ns
        end_time_ns = end_time * 1_000_000  # Convert ms to ns
        query = f"""
            SELECT *
            FROM  /flow_insight.*/
            WHERE flow_id = '{flow_id}'
            AND time >= {start_time_ns}ns AND time <= {end_time_ns}ns
        """
        params = {"q": query, "db": self.db_name, "epoch": "ns"}
        if self.username and self.password:
            params["u"] = self.username
            params["p"] = self.password
        results = await self.client.get(f"{self.server_url}/query", params=params)
        results.raise_for_status()
        data = results.json()
        all_query_results = defaultdict(list)
        if data.get("results") and data["results"][0].get("series"):
            for series in data["results"][0]["series"]:
                columns = series.get("columns", [])
                for point in series.get("values", []):
                    influx_point = dict(zip(columns, point))
                    influx_point["name"] = series.get("name", "")
                    all_query_results[influx_point["name"]].append(influx_point)

        ret = []
        for record_type in RecordType:
            event_class = REVERSE_EVENT_TYPE_MAP.get(record_type.value)

            event_queries = []
            for measurement in measurements_by_type[record_type]:
                for query in all_query_results[measurement]:
                    if record_type in [
                        RecordType.CALL_SUBMIT,
                        RecordType.CALL_BEGIN,
                        RecordType.CALL_END,
                        RecordType.OBJECT_GET,
                        RecordType.OBJECT_PUT,
                    ]:
                        if query["event_type"].lower() == record_type.value.lower():
                            event_queries.append(query)
                    else:
                        event_queries.append(query)

            events = self._reconstruct_events(record_type, event_queries, event_class)
            ret.extend(events)

        return sorted(ret, key=lambda x: x.timestamp)

    async def query_all_events(self) -> List[Any]:
        if not self._flow_creation_times:
            await self._start()

        results = []

        try:
            end_time = int(time.time() * 1000)  # Current time in ms
            start_time = end_time - (24 * 60 * 60 * 1000)  # 24 hours ago

            flow_ids = await self._get_all_flow_ids(start_time, end_time)

            flow_ids.append("_flow_insight_internal_flow_id_")

            # Query events for each flow
            for flow_id in flow_ids:
                try:
                    flow_events = await self.query_events(flow_id, start_time, end_time)
                    results.extend(flow_events)
                except Exception as e:
                    print(f"Error querying events for flow {flow_id}: {e}")

        except Exception as e:
            print(f"Error querying all events: {e}")

        return sorted(results, key=lambda x: x.timestamp)

    async def _get_all_flow_ids(self, start_time: int, end_time: int) -> List[str]:
        if not self._flow_creation_times:
            await self._start()

        flow_ids = set()
        for flow_id, creation_time in self._flow_creation_times.items():
            if creation_time >= start_time and creation_time <= end_time:
                flow_ids.add(flow_id)

        if flow_ids:
            return list(flow_ids)

        query = """
            SELECT flow_id, first(count) FROM "flow_insight.call"
        """

        try:
            params = {"q": query, "db": self.db_name}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password
            result = await self.client.get(f"{self.server_url}/query", params=params)
            result.raise_for_status()
            data = result.json()

            if data.get("results") and data["results"][0].get("series"):
                for series in data["results"][0]["series"]:
                    # Skip first element in columns as it's the name
                    for point in series.get("values", []):
                        if point[0]:
                            flow_ids.add(point[0])

        except Exception as e:
            print(f"Error getting flow IDs from flow_insight.call: {e}")

        return list(flow_ids)

    def filter_and_remap_tags(self, record_type: RecordType, results: List[Dict]) -> List[Dict]:
        if record_type == RecordType.CALL_SUBMIT:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "source_service": result["source_service"],
                "source_instance_id": result["source_instance_id"],
                "source_method": result["source_method"],
                "target_service": result["target_service"],
                "target_instance_id": result["target_instance_id"],
                "target_method": result["target_method"],
                "parent_span_id": result["parent_span_id"],
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.CALL_BEGIN:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "source_service": result["source_service"],
                "source_instance_id": result["source_instance_id"],
                "source_method": result["source_method"],
                "parent_span_id": result["parent_span_id"],
                "span_id": result["span_id"],
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.CALL_END:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "target_service": result["target_service"],
                "target_instance_id": result["target_instance_id"],
                "target_method": result["target_method"],
                "duration": result["duration"],
                "span_id": result["span_id"],
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.OBJECT_GET:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "object_id": result["object_id"],
                "receiver_service": result["receiver_service"],
                "receiver_instance_id": result["receiver_instance_id"],
                "receiver_method": result["receiver_method"],
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.OBJECT_PUT:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "object_id": result["object_id"],
                "object_size": result["size"],
                "object_pos": result["object_pos"],
                "sender_service": result["sender_service"],
                "sender_instance_id": result["sender_instance_id"],
                "sender_method": result["sender_method"],
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.CONTEXT_ADD:
            context_data = {}
            for result in results:
                if result["context_key"] is not None:
                    context_data[result["context_key"]] = result["context_value"]
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "service_name": result["service_name"],
                "instance_id": result["instance_id"],
                "method_name": result["method_name"],
                "context": context_data,
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.RESOURCE_USAGE_ADD:
            resource_data = {}
            for result in results:
                if result["resource_name"] is not None:
                    resource_data[result["resource_name"]] = {
                        "used": result["used"],
                        "base": result["base"],
                    }
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "service_name": result["service_name"],
                "instance_id": result["instance_id"],
                "method_name": result["method_name"],
                "usage": resource_data,
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.DEBUGGER_INFO_ADD:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "span_id": result["span_id"],
                "service_name": result["service_name"],
                "instance_id": result["instance_id"],
                "method_name": result["method_name"],
                "debugger_host": result["debugger_host"],
                "debugger_port": result["debugger_port"],
                "debugger_enabled": result["debugger_enabled"],
                "timestamp": result["time"] // 1_000_000,
            }
        elif record_type == RecordType.SERVICE_PHYSICAL_STATS_ADD:
            service_cpu = {}
            service_memory = {}
            service_gpu = {}
            service_required_resources = {}

            for result in results:
                measurement = result.get("name", "")

                if measurement == "flow_insight.service.cpu":
                    # CPU stats
                    service_cpu[result.get("service", "")] = {
                        "percent": result.get("percent", 0.0),
                        "node_id": result.get("node_id", ""),
                        "state": result.get("state", ""),
                        "pid": result.get("pid", ""),
                    }
                elif measurement.startswith("flow_insight.service.memory"):
                    # Memory stats
                    service = result.get("service", "")
                    mem_type = measurement.split(".")[-1]  # Get rss, vms, etc.

                    if service not in service_memory:
                        service_memory[service] = {}

                    service_memory[service][mem_type] = result.get("value", 0.0)
                elif measurement == "flow_insight.service.required_resource":
                    # Required resources
                    service = result.get("service", "")
                    resource_name = result.get("resource_name", "")

                    if service not in service_required_resources:
                        service_required_resources[service] = {}

                    service_required_resources[service][resource_name] = result.get("value", 0.0)
                elif measurement.startswith("flow_insight.service.gpu"):
                    # GPU stats
                    service = result.get("service", "")
                    device_index = result.get("device_index", "0")

                    if service not in service_gpu:
                        service_gpu[service] = {}

                    if device_index not in service_gpu[service]:
                        service_gpu[service][device_index] = {
                            "name": result.get("device_name", ""),
                            "uuid": result.get("device_uuid", ""),
                            "index": int(device_index),
                            "memory_total": 0,  # Add default memory_total value
                        }

                    # Add gpu memory or utilization
                    if "memory" in measurement:
                        if "memory_total" in measurement:
                            service_gpu[service][device_index]["memory_total"] = result.get(
                                "value", 0.0
                            )
                        else:
                            service_gpu[service][device_index]["memory_used"] = result.get(
                                "used", 0.0
                            )
                    elif "utilization" in measurement:
                        service_gpu[service][device_index]["utilization"] = result.get(
                            "percent", 0.0
                        )

            # Reconstruct the stats structure
            stats_list = []
            for service, cpu_info in service_cpu.items():
                memory_info = service_memory.get(service, {})
                gpu_devices = list(service_gpu.get(service, {}).values())
                required_resources = service_required_resources.get(service, {})

                stats_list.append(
                    {
                        "service": {
                            "service_name": service,
                            "instance_id": results[0].get("instance_id", ""),
                        },
                        "stats": {
                            "node_id": cpu_info.get("node_id", ""),
                            "pid": int(cpu_info.get("pid", 0)),
                            "state": cpu_info.get("state", "unknown"),
                            "cpu_percent": cpu_info.get("percent", 0.0),
                            "memory_info": memory_info,
                            "required_resources": required_resources,
                            "devices": {"gpu": gpu_devices} if gpu_devices else {},
                        },
                    }
                )

            return {
                "flow_id": results[0]["flow_id"],
                "stats": stats_list,
                "timestamp": results[0]["time"] // 1_000_000,
            }
        elif record_type == RecordType.NODE_PHYSICAL_STATS_ADD:
            # Collect node stats data from multiple measurements
            node_cpu = {}
            node_memory = {}
            node_resources = {}
            node_gpu = {}

            for result in results:
                measurement = result.get("name", "")
                node_id = result.get("node_id", "")

                if measurement == "flow_insight.node.cpu":
                    # CPU stats
                    node_cpu[node_id] = {"percent": result.get("percent", 0.0)}
                elif measurement.startswith("flow_insight.node.memory"):
                    # Memory stats
                    mem_type = measurement.split(".")[-1]  # Get total, available, used

                    if node_id not in node_memory:
                        node_memory[node_id] = {}

                    node_memory[node_id][mem_type] = result.get("value", 0.0)
                elif measurement.startswith("flow_insight.resource"):
                    # Resource stats
                    resource_name = result.get("resource_name", "")
                    resource_type = measurement.split(".")[-1]  # Get total or available

                    if node_id not in node_resources:
                        node_resources[node_id] = {}

                    if resource_name not in node_resources[node_id]:
                        node_resources[node_id][resource_name] = {}

                    node_resources[node_id][resource_name][resource_type] = result.get("value", 0.0)
                elif measurement.startswith("flow_insight.node.gpu"):
                    # GPU stats
                    device_index = result.get("device_index", "0")

                    if node_id not in node_gpu:
                        node_gpu[node_id] = {}

                    if device_index not in node_gpu[node_id]:
                        node_gpu[node_id][device_index] = {
                            "name": result.get("device_name", ""),
                            "uuid": result.get("device_uuid", ""),
                            "index": int(device_index),
                            "memory_total": 0,  # Add default memory_total value
                        }

                    # Add gpu memory or utilization
                    if "memory" in measurement:
                        if "memory_total" in measurement:
                            node_gpu[node_id][device_index]["memory_total"] = result.get(
                                "value", 0.0
                            )
                        else:
                            node_gpu[node_id][device_index]["memory_used"] = result.get("used", 0.0)
                    elif "utilization" in measurement:
                        node_gpu[node_id][device_index]["utilization"] = result.get("percent", 0.0)

            # Reconstruct the node stats structure
            node_stats_list = []
            for node_id, cpu_info in node_cpu.items():
                memory_info = node_memory.get(node_id, {})
                resources = node_resources.get(node_id, {})
                gpu_devices = list(node_gpu.get(node_id, {}).values())

                node_stats_list.append(
                    {
                        "node_id": node_id,
                        "cpu_percent": cpu_info.get("percent", 0.0),
                        "memory_info": memory_info,
                        "resources": resources,
                        "required_resources": {},
                        "devices": {"gpu": gpu_devices} if gpu_devices else {},
                    }
                )

            return {
                "flow_id": results[0]["flow_id"],
                "stats": {"stats": node_stats_list},
                "timestamp": results[0]["time"] // 1_000_000,
            }
        elif record_type == RecordType.PROMPT_REGISTER:
            result = results[0]
            return {
                "flow_id": result["flow_id"],
                "prompt": result["prompt_preview"],
                "timestamp": result["time"] // 1_000_000,
            }
        else:
            raise ValueError(f"Unsupported record type: {record_type}")

    def _reconstruct_events(
        self, record_type: RecordType, results: List[Dict], event_class: Any
    ) -> List[Any]:
        events = defaultdict(list)

        for metric_result in results:
            events[metric_result["event_id"]].append(metric_result)

        res = []

        for event_data in events.values():
            res.append(event_class(**self.filter_and_remap_tags(record_type, event_data)))

        return res

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()
