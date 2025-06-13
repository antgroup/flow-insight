from collections import defaultdict
from typing import Callable, List, Optional

from flow_insight.storage.snapshot.base import StorageType
from flow_insight.storage.snapshot.memory_backend import MemoryStorageBackend
from flow_insight.storage.snapshot.model import (
    BatchNodePhysicalStats,
    Breakpoint,
    CallerInfo,
    Context,
    DebuggerInfo,
    Method,
    NodePhysicalStats,
    ObjectEvent,
    ObjectInfo,
    ResourceUsage,
    Service,
    ServicePhysicalStats,
    ServicePhysicalStatsRecord,
)


class SnapshotStorage:
    def __init__(self, storage_backend: StorageType, storage_dir: str = None):
        super().__init__()
        if storage_backend == StorageType.MEMORY:
            self._storage = MemoryStorageBackend(storage_dir)
        else:
            raise ValueError(f"Unsupported storage backend: {storage_backend}")
        self._storage["call_graph"] = defaultdict(
            lambda: defaultdict(lambda: {"count": 0, "start_time": 0})
        )
        self._storage_backend = storage_backend
        self._storage_dir = storage_dir
        self._storage["services"] = defaultdict(set)
        self._storage["methods"] = defaultdict(lambda: defaultdict(list))
        self._storage["functions"] = defaultdict(set)
        self._storage["method_id_map"] = defaultdict(dict)
        self._storage["method_counter"] = defaultdict(int)
        self._storage["function_counter"] = defaultdict(int)
        self._storage["flow_record"] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
        self._storage["flame_tree"] = dict()
        self._storage["debugger_info"] = defaultdict(lambda: defaultdict(dict))
        self._storage["breakpoints"] = defaultdict(lambda: defaultdict(list))
        self._storage["data_flows"] = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
        self._storage["object_events"] = defaultdict(lambda: defaultdict())
        self._storage["caller_info"] = defaultdict(lambda: defaultdict(CallerInfo))
        self._storage["service_physical_stats"] = defaultdict(
            lambda: defaultdict(ServicePhysicalStats)
        )
        self._storage["node_physical_stats"] = defaultdict(NodePhysicalStats)
        self._storage["context_info"] = defaultdict(list)
        self._storage["resource_usage"] = defaultdict(list)
        self._storage["prompt"] = ""

    def restore_snapshots(self):
        snapshots = {}
        for label, snapshot in self._storage.restore_snapshots().items():
            snapshot_storage = SnapshotStorage(self._storage_backend, self._storage_dir)
            snapshot_storage._storage = snapshot
            snapshots[label] = snapshot_storage
        return snapshots

    def store_snapshot(self, label: str, flow_id: str = None):
        self._storage.store_snapshot(label, flow_id)

    def take_snapshot(self):
        snapshot = SnapshotStorage(self._storage_backend, self._storage_dir)
        snapshot._storage = self._storage.take_snapshot()
        return snapshot

    async def get_debugger_info(
        self,
        flow_id: str,
        service: Optional[Service] = None,
        method: Optional[Method] = None,
        span_id: Optional[str] = None,
    ):
        if service is None and method is None:
            return self._storage["debugger_info"][flow_id]
        elif span_id is None:
            return self._storage["debugger_info"][flow_id][self.get_node_id(service, method)]
        else:
            return self._storage["debugger_info"][flow_id][self.get_node_id(service, method)][
                span_id
            ]

    async def set_debugger_info(
        self,
        flow_id: str,
        service: Optional[Service],
        method: Optional[Method],
        span_id: str,
        debugger_info: DebuggerInfo,
    ):
        self._storage["debugger_info"][flow_id][self.get_node_id(service, method)][
            span_id
        ] = debugger_info

    async def get_breakpoints(self, flow_id: str, span_id: str):
        return self._storage["breakpoints"][flow_id][span_id]

    async def set_breakpoints(self, flow_id: str, span_id: str, breakpoints: List[Breakpoint]):
        self._storage["breakpoints"][flow_id][span_id] = breakpoints

    def get_node_id(self, service: Optional[Service], method: Method):
        return (service, method)

    async def set_flame_tree_node(
        self,
        flow_id: str,
        source_service: Optional[Service],
        source_method: Method,
        target_service: Optional[Service],
        target_method: Method,
        start_time: int,
        parent_span_id: str,
        span_id: str,
    ):
        source_id = self.get_node_id(source_service, source_method)
        target_id = self.get_node_id(target_service, target_method)

        def find_and_set_node(root):
            if root["span_id"] == parent_span_id and root["id"] == source_id:
                root["children"].append(
                    {
                        "span_id": span_id,
                        "id": target_id,
                        "start_time": start_time,
                        "children": [],
                    }
                )
                return
            for child in root["children"]:
                find_and_set_node(child)

        if flow_id not in self._storage["flame_tree"]:
            self._storage["flame_tree"][flow_id] = {
                "span_id": parent_span_id,
                "id": source_id,
                "start_time": start_time,
                "children": [],
            }
        find_and_set_node(self._storage["flame_tree"][flow_id])

    async def update_flame_tree_node(
        self,
        flow_id: str,
        target_service: Optional[Service],
        target_method: Method,
        span_id: str,
        end_time: int,
    ):
        target_id = self.get_node_id(target_service, target_method)

        def find_and_update_node(root):
            if root["span_id"] == span_id and root["id"] == target_id:
                root["end_time"] = end_time
                return
            for child in root["children"]:
                find_and_update_node(child)

        if flow_id not in self._storage["flame_tree"]:
            return
        find_and_update_node(self._storage["flame_tree"][flow_id])

    async def get_flame_tree(self, flow_id: str):
        return self._storage["flame_tree"].get(flow_id, None)

    async def update_flow_record(
        self,
        flow_id: str,
        source_service: Optional[Service],
        source_method: Method,
        target_service: Optional[Service],
        target_method: Method,
        func: Callable[[int], int],
    ):
        source_id = self.get_node_id(source_service, source_method)
        target_id = self.get_node_id(target_service, target_method)
        self._storage["flow_record"][flow_id][target_id][source_id] = func(
            self._storage["flow_record"][flow_id][target_id][source_id]
        )

    async def update_call_graph(
        self,
        flow_id: str,
        source_service: Optional[Service],
        source_method: Method,
        target_service: Optional[Service],
        target_method: Method,
        func: Callable[[dict], dict],
    ):
        source_id = self.get_node_id(source_service, source_method)
        target_id = self.get_node_id(target_service, target_method)
        self._storage["call_graph"][flow_id][(source_id, target_id)] = func(
            self._storage["call_graph"][flow_id][(source_id, target_id)]
        )

    async def add_service(self, flow_id: str, service: Service):
        self._storage["services"][flow_id].add(service)

    async def add_methods(self, flow_id: str, service: Service, method: Method):
        if (
            service in self._storage["methods"][flow_id]
            and method in self._storage["methods"][flow_id][service]
            and (service, method) in self._storage["method_id_map"][flow_id]
        ):
            return
        self._storage["method_counter"][flow_id] += 1
        self._storage["method_id_map"][flow_id][(service, method)] = "method" + str(
            self._storage["method_counter"][flow_id]
        )
        if method not in self._storage["methods"][flow_id][service]:
            self._storage["methods"][flow_id][service].append(method)

    async def add_function(self, flow_id: str, function: Method):
        if function.name not in self._storage["functions"][flow_id]:
            fid = None
            if function.name == "_main":
                fid = "_main"
            else:
                self._storage["function_counter"][flow_id] += 1
                fid = "function" + str(self._storage["function_counter"][flow_id])
            self._storage["method_id_map"][flow_id][(None, function)] = fid
            self._storage["functions"][flow_id].add(function)

    async def get_call_graph(self, flow_id: str):
        return self._storage["call_graph"][flow_id]

    async def get_services(self, flow_id: str):
        return self._storage["services"][flow_id]

    async def get_methods(self, flow_id: str):
        res = {}
        methods = self._storage["methods"][flow_id]
        for service, method_set in methods.items():
            for method in method_set:
                method_id = self._storage["method_id_map"][flow_id][(service, method)]
                res[method_id] = (method, service)
        return res

    async def get_functions(self, flow_id: str):
        res = {}
        functions = self._storage["functions"][flow_id]
        for function in functions:
            function_id = self._storage["method_id_map"][flow_id][(None, function)]
            res[function_id] = function
        return res

    async def get_flow_record(self, flow_id: str):
        return self._storage["flow_record"][flow_id]

    async def get_object_events(self, flow_id: str, object_id: str):
        return self._storage["object_events"][flow_id][object_id]

    async def del_object_events(self, flow_id: str, object_id: str):
        if object_id in self._storage["object_events"][flow_id]:
            del self._storage["object_events"][flow_id][object_id]

    async def update_data_flow(
        self,
        flow_id: str,
        source_service: Optional[Service],
        source_method: Method,
        target_service: Optional[Service],
        target_method: Method,
        object_info: ObjectInfo,
    ):
        source_id = self.get_node_id(source_service, source_method)
        target_id = self.get_node_id(target_service, target_method)
        self._storage["data_flows"][flow_id][(source_id, target_id)][
            object_info.argpos
        ] = object_info

    async def get_data_flows(self, flow_id: str):
        return self._storage["data_flows"][flow_id]

    async def add_object_event(self, flow_id: str, object_event: ObjectEvent):
        self._storage["object_events"][flow_id][object_event.object_id] = object_event

    async def add_context(self, flow_id: str, context: Context):
        self._storage["context_info"][flow_id].append(context)

    async def get_contexts(self, flow_id: str):
        return self._storage["context_info"][flow_id]

    async def add_resource_usage(self, flow_id: str, resource_usage: ResourceUsage):
        self._storage["resource_usage"][flow_id].append(resource_usage)

    async def get_resource_usage(self, flow_id: str):
        return self._storage["resource_usage"][flow_id]

    async def add_caller_info(self, flow_id: str, span_id: str, caller_info: CallerInfo):
        self._storage["caller_info"][flow_id][span_id] = caller_info

    async def get_caller_info(self, flow_id: str, span_id: str):
        return self._storage["caller_info"][flow_id][span_id]

    async def del_debugger_info(
        self, flow_id: str, service: Optional[Service], method: Optional[Method], span_id: str
    ):
        if span_id in self._storage["debugger_info"][flow_id][self.get_node_id(service, method)]:
            del self._storage["debugger_info"][flow_id][self.get_node_id(service, method)][span_id]

    async def batch_add_service_physical_stats(
        self, flow_id: str, stats: List[ServicePhysicalStatsRecord]
    ):
        for record in stats:
            self._storage["service_physical_stats"][flow_id][record.service] = record.stats

    async def get_service_physical_stats(self, flow_id: str):
        return self._storage["service_physical_stats"][flow_id]

    async def batch_add_node_physical_stats(self, stats: BatchNodePhysicalStats):
        for node_stats in stats.stats.stats:
            self._storage["node_physical_stats"][node_stats.node_id] = node_stats

    async def get_node_physical_stats(self):
        return self._storage["node_physical_stats"]

    async def get_method_id_map(self, flow_id: str):
        return self._storage["method_id_map"][flow_id]

    async def get_prompt(self):
        return self._storage["prompt"]

    async def set_prompt(self, prompt: str):
        self._storage["prompt"] = prompt
