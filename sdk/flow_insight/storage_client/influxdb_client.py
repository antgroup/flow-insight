import asyncio
import base64
import time
import uuid

import httpx
from pydantic import BaseModel

from flow_insight.storage.persist.base import StorageClient
from flow_insight.storage.persist.model import RecordType, internal_flow_id


class InfluxDBStorageClient(StorageClient):
    def __init__(
        self, server_url: str, username: str = None, password: str = None, session_id: str = None
    ):
        super().__init__()
        self.server_url = server_url.rstrip("/")
        self.db_name = f"flow_insight_{session_id}"
        self.username = username
        self.password = password
        self.sync_client = httpx.Client(timeout=30.0)
        self.async_client = httpx.AsyncClient(timeout=30.0)

        self._create_database_if_not_exists()

    def _create_database_if_not_exists(self):
        """Create the InfluxDB database if it doesn't exist."""
        try:
            # First check if database exists
            query = "SHOW DATABASES"
            params = {"q": query}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password

            result = self.sync_client.get(f"{self.server_url}/query", params=params)
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

                result = self.sync_client.get(f"{self.server_url}/query", params=params)
                result.raise_for_status()

            # Check if the flow_insight retention policy exists
            query = f"SHOW RETENTION POLICIES ON {self.db_name}"
            params = {"q": query}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password

            result = self.sync_client.get(f"{self.server_url}/query", params=params)
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

                result = self.sync_client.get(f"{self.server_url}/query", params=params)
                result.raise_for_status()

        except Exception as e:
            print(f"Error creating database or retention policy: {e}")

    async def async_ping(self):
        """Check if the InfluxDB server is reachable"""
        try:
            params = {}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password
            response = await self.async_client.get(f"{self.server_url}/ping", params=params)
            return {"result": response.status_code == 204}
        except Exception:
            return {"result": False}

    def sync_ping(self):
        """Synchronous version of ping"""
        try:
            params = {}
            if self.username and self.password:
                params["u"] = self.username
                params["p"] = self.password
            response = self.sync_client.get(f"{self.server_url}/ping", params=params)
            return {"result": response.status_code == 204}
        except Exception:
            return {"result": False}

    def _generate_event_id(self, record_type, record_dict):
        """Generate a unique event ID based on record type and content

        The ID includes:
        - A short unique identifier
        - Record type
        - Timestamp from the event
        """
        # Get timestamp, defaulting to current time if not present
        timestamp = record_dict.get("timestamp", int(time.time()))

        # Generate a short UUID portion (first 8 chars)
        unique_id = str(uuid.uuid4())[:8]

        # Create an ID format: type_uniqueid_timestamp
        return f"{record_type.value}_{unique_id}_{timestamp}"

    def _process_record(self, record_type: RecordType, record: BaseModel):
        """Process metrics based on the record type"""
        record_dict = record.model_dump()
        flow_id = record_dict.get("flow_id", internal_flow_id)

        # Generate a unique event ID
        event_id = self._generate_event_id(record_type, record_dict)
        timestamp_ns = record_dict.get("timestamp", int(time.time() * 1_000_000_000))

        # Convert millisecond timestamp to nanosecond timestamp for InfluxDB if needed
        if timestamp_ns < 1_000_000_000_000_000:  # If timestamp is in milliseconds
            timestamp_ns *= 1_000_000  # Convert to nanoseconds

        if record_type == RecordType.CALL_SUBMIT:
            # Extract fields from CallSubmitEvent
            tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "call_submit"}
            self._add_tag_if_present(tags, record_dict, "source_service")
            self._add_tag_if_present(tags, record_dict, "source_instance_id")
            self._add_tag_if_present(tags, record_dict, "source_method")
            self._add_tag_if_present(tags, record_dict, "target_service")
            self._add_tag_if_present(tags, record_dict, "target_instance_id")
            self._add_tag_if_present(tags, record_dict, "target_method")
            self._add_tag_if_present(tags, record_dict, "parent_span_id")

            # Write to InfluxDB
            point = self._create_point("flow_insight.call", tags, {"count": 1}, timestamp_ns)
            self._write(point)

        elif record_type == RecordType.CALL_BEGIN:
            # Extract fields from CallBeginEvent
            tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "call_begin"}
            self._add_tag_if_present(tags, record_dict, "source_service")
            self._add_tag_if_present(tags, record_dict, "source_instance_id")
            self._add_tag_if_present(tags, record_dict, "source_method")
            self._add_tag_if_present(tags, record_dict, "span_id")
            self._add_tag_if_present(tags, record_dict, "parent_span_id")

            # Write to InfluxDB
            point = self._create_point("flow_insight.call", tags, {"count": 1}, timestamp_ns)
            self._write(point)

        elif record_type == RecordType.CALL_END:
            # Extract fields from CallEndEvent
            tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "call_end"}
            self._add_tag_if_present(tags, record_dict, "target_service")
            self._add_tag_if_present(tags, record_dict, "target_instance_id")
            self._add_tag_if_present(tags, record_dict, "target_method")
            self._add_tag_if_present(tags, record_dict, "span_id")

            fields = {"count": 1}

            # Send call duration if available
            if "duration" in record_dict:
                fields["duration"] = float(record_dict["duration"])

            # Write to InfluxDB
            point = self._create_point("flow_insight.call", tags, fields, timestamp_ns)
            self._write(point)

        elif record_type == RecordType.OBJECT_GET:
            # Extract fields from ObjectGetEvent
            tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "object_get"}
            self._add_tag_if_present(tags, record_dict, "object_id")
            self._add_tag_if_present(tags, record_dict, "receiver_service")
            self._add_tag_if_present(tags, record_dict, "receiver_instance_id")
            self._add_tag_if_present(tags, record_dict, "receiver_method")

            # Write to InfluxDB
            point = self._create_point("flow_insight.object", tags, {"count": 1}, timestamp_ns)
            self._write(point)

        elif record_type == RecordType.OBJECT_PUT:
            # Extract fields from ObjectPutEvent
            tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "object_put"}
            self._add_tag_if_present(tags, record_dict, "object_id")
            self._add_tag_if_present(tags, record_dict, "sender_service")
            self._add_tag_if_present(tags, record_dict, "sender_instance_id")
            self._add_tag_if_present(tags, record_dict, "sender_method")
            if "object_pos" in record_dict:
                tags["object_pos"] = str(record_dict["object_pos"])

            fields = {"count": 1}

            # Send object size if available
            if "object_size" in record_dict:
                fields["size"] = float(record_dict["object_size"])

            # Write to InfluxDB
            point = self._create_point("flow_insight.object", tags, fields, timestamp_ns)
            self._write(point)

        elif record_type == RecordType.CONTEXT_ADD:
            # Extract fields from ContextEvent
            base_tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "context_add"}
            self._add_tag_if_present(base_tags, record_dict, "service_name")
            self._add_tag_if_present(base_tags, record_dict, "instance_id")
            self._add_tag_if_present(base_tags, record_dict, "method_name")

            # Store event data for context reconstruction
            context_data = record_dict.get("context", {})
            # Store context data count to help with reconstruction
            base_tags["context_count"] = str(len(context_data))

            # Send a point for each context key-value pair with the same event_id
            for key, value in context_data.items():
                context_tags = base_tags.copy()
                context_tags["context_key"] = key
                context_tags["context_value"] = str(value)

                context_point = self._create_point(
                    "flow_insight.context", context_tags, {"count": 1}, timestamp_ns
                )
                self._write(context_point)

        elif record_type == RecordType.RESOURCE_USAGE_ADD:
            # Extract fields from ResourceUsageEvent
            base_tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "resource_usage"}
            self._add_tag_if_present(base_tags, record_dict, "service_name")
            self._add_tag_if_present(base_tags, record_dict, "instance_id")
            self._add_tag_if_present(base_tags, record_dict, "method_name")

            # Store usage count to help with reconstruction
            usage_data = record_dict.get("usage", {})
            base_tags["usage_count"] = str(len(usage_data))

            # Send a point for each resource usage with the same event_id
            for resource_name, usage_model in usage_data.items():
                resource_tags = base_tags.copy()
                resource_tags["resource_name"] = resource_name

                fields = {"count": 1}

                resource_tags["base"] = usage_model["base"]
                resource_tags["used"] = str(usage_model["used"])

                resource_point = self._create_point(
                    "flow_insight.resource", resource_tags, fields, timestamp_ns
                )
                self._write(resource_point)

        elif record_type == RecordType.DEBUGGER_INFO_ADD:
            # Extract fields from DebuggerInfoEvent
            tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "debugger_info"}
            self._add_tag_if_present(tags, record_dict, "service_name")
            self._add_tag_if_present(tags, record_dict, "instance_id")
            self._add_tag_if_present(tags, record_dict, "method_name")
            self._add_tag_if_present(tags, record_dict, "span_id")
            self._add_tag_if_present(tags, record_dict, "debugger_host")
            self._add_tag_if_present(tags, record_dict, "debugger_port")
            self._add_tag_if_present(tags, record_dict, "debugger_enabled")
            self._add_tag_if_present(tags, record_dict, "source_dir")
            self._add_tag_if_present(tags, record_dict, "trim_level")

            fields = {"count": 1}

            point = self._create_point("flow_insight.debugger", tags, fields, timestamp_ns)
            self._write(point)

        elif record_type == RecordType.SERVICE_PHYSICAL_STATS_ADD:
            # Process BatchServicePhysicalStatsEvent
            batch_tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "service_stats"}
            batch_tags["stats_count"] = str(len(record_dict.get("stats", [])))

            # Process each service stat with the parent event_id
            for index, stat_record in enumerate(record_dict.get("stats", [])):
                service = stat_record.get("service", {})
                stats = stat_record.get("stats", {})

                service_name = service.get("service_name", "unknown")
                instance_id = service.get("instance_id", "unknown")
                node_id = stats.get("node_id", "unknown")

                # Base tags for all service metrics
                service_tags = {
                    "flow_id": flow_id,
                    "event_id": event_id,
                    "service": service_name,
                    "instance_id": instance_id,
                    "node_id": node_id,
                    "stat_index": str(index),
                }

                if "state" in stats:
                    service_tags["state"] = stats["state"]
                if "pid" in stats:
                    service_tags["pid"] = str(stats["pid"])

                # CPU usage
                if "cpu_percent" in stats:
                    cpu_point = self._create_point(
                        "flow_insight.service.cpu",
                        service_tags,
                        {"percent": float(stats["cpu_percent"])},
                        timestamp_ns,
                    )
                    self._write(cpu_point)

                # Memory metrics
                memory_info = stats.get("memory_info", {})
                for mem_key in ["rss", "vms", "shared", "text", "lib", "data", "dirty"]:
                    if mem_key in memory_info and memory_info[mem_key] is not None:
                        mem_point = self._create_point(
                            f"flow_insight.service.memory.{mem_key}",
                            service_tags,
                            {"value": float(memory_info[mem_key])},
                            timestamp_ns,
                        )
                        self._write(mem_point)

                # Required resources - store as a tag to help with reconstructing the service stats
                required_resources = stats.get("required_resources", {})
                for resource_name, resource_value in required_resources.items():
                    resource_tags = service_tags.copy()
                    resource_tags["resource_name"] = resource_name

                    resource_point = self._create_point(
                        "flow_insight.service.required_resource",
                        resource_tags,
                        {"value": float(resource_value)},
                        timestamp_ns,
                    )
                    self._write(resource_point)

                # GPU metrics
                for device_index, device in enumerate(stats.get("devices", {}).get("gpu", [])):
                    gpu_tags = service_tags.copy()
                    gpu_tags["device_index"] = str(device.get("index", 0))
                    gpu_tags["device_name"] = device.get("name", "")
                    gpu_tags["device_uuid"] = device.get("uuid", "")
                    gpu_tags["gpu_index"] = str(device_index)

                    if "memory_total" in device:
                        gpu_mem_total_point = self._create_point(
                            "flow_insight.service.gpu.memory_total",
                            gpu_tags,
                            {"value": float(device["memory_total"])},
                            timestamp_ns,
                        )
                        self._write(gpu_mem_total_point)

                    if "memory_used" in device:
                        gpu_mem_point = self._create_point(
                            "flow_insight.service.gpu.memory",
                            gpu_tags,
                            {"used": float(device["memory_used"])},
                            timestamp_ns,
                        )
                        self._write(gpu_mem_point)

                    if "utilization" in device:
                        gpu_util_point = self._create_point(
                            "flow_insight.service.gpu.utilization",
                            gpu_tags,
                            {"percent": float(device["utilization"])},
                            timestamp_ns,
                        )
                        self._write(gpu_util_point)

        elif record_type == RecordType.NODE_PHYSICAL_STATS_ADD:
            # Process BatchNodePhysicalStatsEvent
            batch_tags = {"flow_id": flow_id, "event_id": event_id, "event_type": "node_stats"}

            # Get nested stats count
            node_stats = record_dict.get("stats", {}).get("stats", [])
            batch_tags["stats_count"] = str(len(node_stats))

            # Process each node stat with the parent event_id
            for index, node_stat in enumerate(node_stats):
                node_id = node_stat.get("node_id", "unknown")

                # Base tags for node metrics
                node_tags = {
                    "flow_id": flow_id,
                    "event_id": event_id,
                    "node_id": node_id,
                    "node_index": str(index),
                }

                # CPU usage
                if "cpu_percent" in node_stat:
                    cpu_point = self._create_point(
                        "flow_insight.node.cpu",
                        node_tags,
                        {"percent": float(node_stat["cpu_percent"])},
                        timestamp_ns,
                    )
                    self._write(cpu_point)

                # Memory metrics
                memory_info = node_stat.get("memory_info", {})
                for mem_key in ["total", "available", "used"]:
                    if mem_key in memory_info and memory_info[mem_key] is not None:
                        mem_point = self._create_point(
                            f"flow_insight.node.memory.{mem_key}",
                            node_tags,
                            {"value": float(memory_info[mem_key])},
                            timestamp_ns,
                        )
                        self._write(mem_point)

                # Resource metrics
                for resource_name, resource_usage in node_stat.get("resources", {}).items():
                    resource_tags = {**node_tags, "resource_name": resource_name}

                    # Record total and available resource
                    if "total" in resource_usage:
                        total_point = self._create_point(
                            "flow_insight.resource.total",
                            resource_tags,
                            {"value": float(resource_usage["total"])},
                            timestamp_ns,
                        )
                        self._write(total_point)

                    if "available" in resource_usage:
                        avail_point = self._create_point(
                            "flow_insight.resource.available",
                            resource_tags,
                            {"value": float(resource_usage["available"])},
                            timestamp_ns,
                        )
                        self._write(avail_point)

                # GPU metrics
                for device_index, device in enumerate(node_stat.get("devices", {}).get("gpu", [])):
                    gpu_tags = node_tags.copy()
                    gpu_tags["device_index"] = str(device.get("index", 0))
                    gpu_tags["device_name"] = device.get("name", "")
                    gpu_tags["device_uuid"] = device.get("uuid", "")
                    gpu_tags["gpu_index"] = str(device_index)

                    if "memory_total" in device:
                        gpu_mem_total_point = self._create_point(
                            "flow_insight.node.gpu.memory_total",
                            gpu_tags,
                            {"value": float(device["memory_total"])},
                            timestamp_ns,
                        )
                        self._write(gpu_mem_total_point)

                    if "memory_used" in device:
                        gpu_mem_point = self._create_point(
                            "flow_insight.node.gpu.memory",
                            gpu_tags,
                            {"used": float(device["memory_used"])},
                            timestamp_ns,
                        )
                        self._write(gpu_mem_point)

                    if "utilization" in device:
                        gpu_util_point = self._create_point(
                            "flow_insight.node.gpu.utilization",
                            gpu_tags,
                            {"percent": float(device["utilization"])},
                            timestamp_ns,
                        )
                        self._write(gpu_util_point)

        elif record_type == RecordType.PROMPT_REGISTER:
            # Process PromptRegisterEvent
            tags = {
                "flow_id": flow_id,
                "event_id": event_id,
                "event_type": "prompt_register",
            }

            # Also store the actual prompt as a tag
            prompt = record_dict.get("prompt", "")
            tags["prompt"] = base64.b64encode(prompt.encode()).decode()

            point = self._create_point("flow_insight.prompt", tags, {"count": 1}, timestamp_ns)
            self._write(point)

    def _add_tag_if_present(self, tags_dict, record_dict, field_name):
        """Add a tag if the field is present and not None in the record"""
        if field_name in record_dict and record_dict[field_name] is not None:
            tags_dict[field_name] = str(record_dict[field_name])

    def _create_point(self, measurement, tags, fields, timestamp):
        """Create a line protocol point for InfluxDB"""
        # Format tags
        # Escape spaces in tag values with backslashes
        escaped_tags = {}
        for k, v in tags.items():
            # Replace spaces with backslashes and spaces, and escape commas and equals signs
            if isinstance(v, str):
                v = v.replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")
            escaped_tags[k] = v

        tag_str = ",".join([f"{k}={v}" for k, v in sorted(escaped_tags.items())])

        # Format fields
        field_str = ",".join([f"{k}={v}" for k, v in sorted(fields.items())])

        # Create line protocol
        if tag_str:
            return f"{measurement},{tag_str} {field_str} {timestamp}"
        else:
            return f"{measurement} {field_str} {timestamp}"

    def _write(self, data):
        retry = 5
        while retry > 0:
            try:
                params = {"db": self.db_name, "precision": "ns"}
                if self.username and self.password:
                    params["u"] = self.username
                    params["p"] = self.password
                response = self.sync_client.post(
                    f"{self.server_url}/write", params=params, content=data
                )
                response.raise_for_status()
                return
            except Exception:
                time.sleep(1)
            retry -= 1

    async def _async_write(self, data):
        retry = 5
        while retry > 0:
            try:
                params = {"db": self.db_name, "precision": "ns"}
                if self.username and self.password:
                    params["u"] = self.username
                    params["p"] = self.password
                response = await self.async_client.post(
                    f"{self.server_url}/write", params=params, content=data
                )
                response.raise_for_status()
                return
            except Exception:
                await asyncio.sleep(1)
            retry -= 1

    async def async_emit_record(self, record_type: RecordType, record: BaseModel):
        """Asynchronously emit a record to InfluxDB"""
        self._process_record(record_type, record)

    def sync_emit_record(self, record_type: RecordType, record: BaseModel):
        """Synchronously emit a record to InfluxDB"""
        self._process_record(record_type, record)

    def emit_record(self, record_type: RecordType, record: BaseModel):
        """Legacy method for backwards compatibility"""
        self.sync_emit_record(record_type, record)

    async def aclose(self):
        """Asynchronously close the InfluxDB client"""
        await self._async_flush_batch()
        await self.async_client.aclose()

    def close(self):
        """Synchronously close the InfluxDB client"""
        self._flush_batch()
        self.sync_client.close()
