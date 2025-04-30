import asyncio
from collections import defaultdict
from typing import Any, Dict, List, Optional

from flow_insight.dap.client import DAPClient
from flow_insight.storage.persist.base import StorageType as PersistStorageType
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
    ResourceUsageEvent,
    ServicePhysicalStatsRecord,
    internal_flow_id,
)
from flow_insight.storage.persist.persist import PersistStorage
from flow_insight.storage.snapshot.base import StorageType
from flow_insight.storage.snapshot.model import (
    AggregatedFlameGraphData,
    Breakpoint,
    CallerInfo,
    CallFlow,
    CallGraphData,
    Context,
    DataFlow,
    DebugCommand,
    DebuggerInfo,
    DebugSession,
    FlameDataAggregated,
    FlameGraphData,
    Method,
    MethodInfo,
    ObjectEvent,
    ObjectInfo,
    ParentStartTimes,
    PhysicalViewData,
    ResourceUsage,
    Service,
    TotalInParent,
)
from flow_insight.storage.snapshot.snapshot import SnapshotStorage


class InsightEngine:
    def __init__(self, storage_type: StorageType, persist_storage_config: dict):
        self._persist_storage = PersistStorage(PersistStorageType.DISK, persist_storage_config)
        self._debug_sessions = defaultdict(dict)
        self._snapshots = {"latest": SnapshotStorage(storage_type)}
        self._flow_creation_time = {}

    async def get_debug_sessions(
        self,
        flow_id: str,
        service_name: Optional[str],
        instance_id: Optional[str],
        method_name: Optional[str],
        filter_active: bool = False,
        snapshot: Optional[SnapshotStorage] = None,
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        if service_name is None and instance_id is None and method_name is None:
            debugger_info = await snapshot.get_debugger_info(flow_id)
            ret = []
            for (service, method), span_ids in debugger_info.items():
                for span_id in span_ids:
                    if filter_active and span_id not in self._debug_sessions.get(flow_id, {}):
                        continue
                    ret.append(DebugSession(service=service, method=method, span_id=span_id))
            return ret
        ret = []
        service = (
            Service(service_name=service_name, instance_id=instance_id) if service_name else None
        )
        method = Method(name=method_name)
        debugger_infos = await snapshot.get_debugger_info(flow_id, service, method)
        for span_id, debugger_info in debugger_infos.items():
            ret.append(DebugSession(service=service, method=method, span_id=span_id))
        return ret

    async def get_breakpoints(
        self, flow_id: str, span_id: str, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        return await snapshot.get_breakpoints(flow_id, span_id)

    async def set_breakpoints(
        self,
        flow_id: str,
        span_id: str,
        breakpoints: List[Breakpoint],
        snapshot: Optional[SnapshotStorage] = None,
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        return await snapshot.set_breakpoints(flow_id, span_id, breakpoints)

    async def activate_debug_session(
        self,
        flow_id: str,
        service_name: Optional[str],
        instance_id: Optional[str],
        method_name: Optional[str],
        span_id: str,
        snapshot: Optional[SnapshotStorage] = None,
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        service = (
            Service(service_name=service_name, instance_id=instance_id) if service_name else None
        )
        method = Method(name=method_name)
        debugger_info = await snapshot.get_debugger_info(flow_id, service, method, span_id)
        dap = DAPClient(debugger_info.debugger_host, debugger_info.debugger_port)
        await dap.connect()
        await dap.initialize()
        await dap.attach()
        self._debug_sessions[flow_id][span_id] = dap

    async def debug_cmd(
        self, flow_id: str, span_id: str, command: DebugCommand, args: Dict[str, Any]
    ):
        dap = self._debug_sessions[flow_id][span_id]
        result = None
        if command == DebugCommand.CONTINUE:
            await dap.continue_execution()
        elif command == DebugCommand.PAUSE:
            await dap.pause(args.get("thread_id", 0))
        elif command == DebugCommand.STEP_OVER:
            await dap.step_over(args.get("thread_id", 0))
        elif command == DebugCommand.STEP_INTO:
            await dap.step_in(args.get("thread_id", 0))
        elif command == DebugCommand.STEP_OUT:
            await dap.step_out(args.get("thread_id", 0))
        elif command == DebugCommand.GET_THREADS:
            result = await dap.get_threads()
        elif command == DebugCommand.GET_STACK_TRACE:
            result = await dap.get_stack_trace(args.get("thread_id", 0))
        elif command == DebugCommand.SET_BREAKPOINTS:
            result = await dap.set_breakpoints(args.get("source", {}), args.get("lines", []))
        elif command == DebugCommand.EVALUATE:
            result = await dap.evaluate(
                args.get("expression", ""),
                args.get("frame_id", 0),
                args.get("thread_id", 0),
            )
        return result

    async def deactivate_debug_session(self, flow_id: str, span_id: str):
        dap = self._debug_sessions[flow_id][span_id]
        await dap.disconnect_request()
        await dap.disconnect()
        del self._debug_sessions[flow_id][span_id]

    async def get_active_debug_sessions(self, flow_id: str):
        if flow_id not in self._debug_sessions:
            return []
        return list(self._debug_sessions[flow_id].keys())

    async def get_prompt(self, snapshot: Optional[SnapshotStorage] = None):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        return await snapshot.get_prompt()

    async def get_physical_view_data(
        self, flow_id: str, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        node_physical_stats = await snapshot.get_node_physical_stats()
        service_physical_stats = await snapshot.get_service_physical_stats(flow_id)
        services_stats = []
        for service, stats in service_physical_stats.items():
            services_stats.append(ServicePhysicalStatsRecord(service=service, stats=stats))
        return PhysicalViewData(services=services_stats, nodes=node_physical_stats)

    async def get_call_graph_data(
        self, flow_id, stack_mode=False, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        graph_data = CallGraphData(
            services=[],
            methods=[],
            functions=[],
            callFlows=[],
            dataFlows=[],
        )

        call_graph = await snapshot.get_call_graph(flow_id)
        data_flows = await snapshot.get_data_flows(flow_id)
        services = await snapshot.get_services(flow_id)
        methods = await snapshot.get_methods(flow_id)
        functions = await snapshot.get_functions(flow_id)
        if stack_mode:
            (
                call_graph,
                reachable_methods,
                reachable_services,
                reachable_funcs,
            ) = await self.filter_call_graph_data(flow_id, call_graph, snapshot)

        method_id_map = await snapshot.get_method_id_map(flow_id)

        # Add actors
        for service in services:
            if stack_mode and service.instance_id not in reachable_services:
                continue
            graph_data.services.append(service)
        # Add methods
        for method_id, (method, service) in methods.items():
            if stack_mode:
                if (
                    service.instance_id not in reachable_services
                    or method.name not in reachable_methods
                ):
                    continue
            graph_data.methods.append(MethodInfo(id=method_id, method=method, service=service))

        # Add functions
        for function_id, function in functions.items():
            if stack_mode:
                if function.name not in reachable_funcs:
                    continue
            graph_data.functions.append(MethodInfo(id=function_id, method=function, service=None))

        # Add call flows
        for call_edge, info in call_graph.items():
            (source_service, source_method), (target_service, target_method) = call_edge
            graph_data.callFlows.append(
                CallFlow(
                    source_id=method_id_map[source_service, source_method],
                    target_id=method_id_map[target_service, target_method],
                    count=info["count"],
                    start_time=info["start_time"],
                )
            )

        for flow_key, entry in data_flows.items():
            for argpos, flow_stats in entry.items():
                (source_service, source_method), (target_service, target_method) = flow_key
                if stack_mode:
                    if source_service is not None:
                        if source_method.name not in reachable_methods:
                            continue
                        if source_service.instance_id not in reachable_services:
                            continue
                    else:
                        if source_method.name not in reachable_funcs:
                            continue
                    if target_service is not None:
                        if target_method.name not in reachable_methods:
                            continue
                        if target_service.instance_id not in reachable_services:
                            continue
                    else:
                        if target_method.name not in reachable_funcs:
                            continue

                total_size_mb = flow_stats.size / (1024 * 1024)
                graph_data.dataFlows.append(
                    DataFlow(
                        argpos=argpos,
                        source_id=method_id_map[source_service, source_method],
                        target_id=method_id_map[target_service, target_method],
                        duration=flow_stats.duration,
                        size=total_size_mb,
                        timestamp=flow_stats.timestamp,
                    )
                )

        has_main = False
        for function in graph_data.functions:
            if function.method.name == "_main":
                has_main = True
                break
        if not has_main:
            graph_data.functions.append(
                MethodInfo(
                    id="_main",
                    method=Method(name="_main"),
                    service=None,
                )
            )

        return graph_data

    async def filter_call_graph_data(self, flow_id, call_graph, snapshot: SnapshotStorage = None):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        target_edges = defaultdict(set)
        reachable_methods = set()
        reachable_services = set()
        reachable_funcs = set()
        flow_record = await snapshot.get_flow_record(flow_id)

        # Build target edges from flow records
        for callee_id, caller_ids in flow_record.items():
            for caller_id, call_times in caller_ids.items():
                if call_times > 0:
                    target_edges[callee_id].add((caller_id, callee_id))

        # Filter call_graph to only keep edges between reachable nodes
        filtered_graph = {}
        for edges in target_edges.values():
            for edge in edges:
                filtered_graph[edge] = call_graph[edge]
                (source_service, source_method), (target_service, target_method) = edge
                if source_service is not None:
                    reachable_methods.add(source_method.name)
                    reachable_services.add(source_service.instance_id)
                else:
                    reachable_funcs.add(source_method.name)
                if target_service is not None:
                    reachable_methods.add(target_method.name)
                    reachable_services.add(target_service.instance_id)
                else:
                    reachable_funcs.add(target_method.name)

        return filtered_graph, reachable_methods, reachable_services, reachable_funcs

    async def get_flow_creation_time(self, flow_id: str):
        return self._flow_creation_time.get(flow_id, -1)

    async def record_event(self, event: any):
        if event.flow_id not in self._flow_creation_time:
            self._flow_creation_time[event.flow_id] = event.timestamp
        if isinstance(event, CallSubmitEvent):
            await self.emit_call_submit(event)
        elif isinstance(event, CallBeginEvent):
            await self.emit_call_begin(event)
        elif isinstance(event, CallEndEvent):
            await self.emit_call_end(event)
        elif isinstance(event, ObjectGetEvent):
            await self.emit_object_get(event)
        elif isinstance(event, ObjectPutEvent):
            await self.emit_object_put(event)
        elif isinstance(event, ContextEvent):
            await self.emit_context(event)
        elif isinstance(event, ResourceUsageEvent):
            await self.emit_resource_usage(event)
        elif isinstance(event, DebuggerInfoEvent):
            await self.emit_debugger_info(event)
        elif isinstance(event, BatchServicePhysicalStatsEvent):
            await self.emit_service_physical_stats(event)
        elif isinstance(event, BatchNodePhysicalStatsEvent):
            await self.emit_node_physical_stats(event)
        elif isinstance(event, PromptRegisterEvent):
            await self.emit_prompt(event)
        else:
            raise ValueError(f"Unknown event type: {type(event)}")

        asyncio.create_task(self._persist_storage.record_event(event))

    async def replay(self, flow_id: str, end_time: int):
        latest_snapshot = SnapshotStorage(StorageType.MEMORY)
        events = await self._persist_storage.query_events(flow_id, -1, end_time)
        events.extend(await self._persist_storage.query_events(internal_flow_id, -1, end_time))
        for event in events:
            if isinstance(event, CallSubmitEvent):
                await self.emit_call_submit(event, latest_snapshot)
            elif isinstance(event, CallBeginEvent):
                await self.emit_call_begin(event, latest_snapshot)
            elif isinstance(event, CallEndEvent):
                await self.emit_call_end(event, latest_snapshot)
            elif isinstance(event, ObjectGetEvent):
                await self.emit_object_get(event, latest_snapshot)
            elif isinstance(event, ObjectPutEvent):
                await self.emit_object_put(event, latest_snapshot)
            elif isinstance(event, ContextEvent):
                await self.emit_context(event, latest_snapshot)
            elif isinstance(event, ResourceUsageEvent):
                await self.emit_resource_usage(event, latest_snapshot)
            elif isinstance(event, DebuggerInfoEvent):
                await self.emit_debugger_info(event, latest_snapshot)
            elif isinstance(event, BatchServicePhysicalStatsEvent):
                await self.emit_service_physical_stats(event, latest_snapshot)
            elif isinstance(event, BatchNodePhysicalStatsEvent):
                await self.emit_node_physical_stats(event, latest_snapshot)
            elif isinstance(event, PromptRegisterEvent):
                await self.emit_prompt(event, latest_snapshot)
            else:
                raise ValueError(f"Unknown event type: {type(event)}")

        return latest_snapshot

    async def emit_call_submit(
        self, call_submit: CallSubmitEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = call_submit.flow_id
        source_service = (
            Service(
                service_name=call_submit.source_service, instance_id=call_submit.source_instance_id
            )
            if call_submit.source_service
            else None
        )
        source_method = Method(name=call_submit.source_method)
        target_service = (
            Service(
                service_name=call_submit.target_service, instance_id=call_submit.target_instance_id
            )
            if call_submit.target_service
            else None
        )
        target_method = Method(name=call_submit.target_method)
        start_time = call_submit.timestamp

        await snapshot.set_start_time(
            flow_id, source_service, source_method, target_service, target_method, start_time
        )
        await snapshot.update_flow_record(
            flow_id,
            source_service,
            source_method,
            target_service,
            target_method,
            lambda record: record + 1,
        )
        await snapshot.update_call_graph(
            flow_id,
            source_service,
            source_method,
            target_service,
            target_method,
            lambda record: {"count": record.get("count", 0) + 1, "start_time": start_time},
        )

        if source_service is not None:
            await snapshot.add_service(flow_id, source_service)
            await snapshot.add_methods(flow_id, source_service, source_method)
        else:
            await snapshot.add_function(flow_id, source_method)

        if target_service is not None:
            await snapshot.add_service(flow_id, target_service)
            await snapshot.add_methods(flow_id, target_service, target_method)
        else:
            await snapshot.add_function(flow_id, target_method)

    async def emit_object_get(
        self, object_get: ObjectGetEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = object_get.flow_id
        object_id = object_get.object_id
        timestamp = object_get.timestamp
        object_event: ObjectEvent = await snapshot.get_object_events(flow_id, object_id)
        caller_service = object_event.sender_service
        caller_method = object_event.sender_method
        callee_service = (
            Service(
                service_name=object_get.receiver_service,
                instance_id=object_get.receiver_instance_id,
            )
            if object_get.receiver_service is not None
            else None
        )
        callee_method = Method(name=object_get.receiver_method)
        argpos = object_event.object_info.argpos
        size = object_event.object_info.size

        await snapshot.del_object_events(flow_id, object_id)
        duration = timestamp - object_event.timestamp

        await snapshot.update_data_flow(
            flow_id,
            caller_service,
            caller_method,
            callee_service,
            callee_method,
            ObjectInfo(size=size, argpos=argpos, duration=duration, timestamp=timestamp),
        )

    async def emit_object_put(
        self, object_put: ObjectPutEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        """Record object transfer between methods/functions."""
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = object_put.flow_id
        service = (
            Service(
                service_name=object_put.sender_service, instance_id=object_put.sender_instance_id
            )
            if object_put.sender_service is not None
            else None
        )
        method = Method(name=object_put.sender_method)
        object_event = ObjectEvent(
            timestamp=object_put.timestamp,
            object_id=object_put.object_id,
            sender_service=service,
            sender_method=method,
            object_info=ObjectInfo(
                size=object_put.object_size,
                argpos=object_put.object_pos,
                duration=0,
                timestamp=object_put.timestamp,
            ),
        )
        await snapshot.add_object_event(flow_id, object_event)

    async def emit_context(
        self, context_add: ContextEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = context_add.flow_id
        if context_add.service_name is not None:
            service = Service(
                service_name=context_add.service_name, instance_id=context_add.instance_id
            )
            method = Method(name=context_add.method_name)
            context = Context(service=service, method=method, context=context_add.context)
            await snapshot.add_context(flow_id, context)
        else:
            method = Method(name=context_add.method_name)
            context = Context(service=None, method=method, context=context_add.context)
            await snapshot.add_context(flow_id, context)

    async def get_context(self, flow_id, snapshot: Optional[SnapshotStorage] = None):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        return await snapshot.get_contexts(flow_id)

    async def emit_resource_usage(
        self, resource_usage: ResourceUsageEvent, snapshot: SnapshotStorage = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = resource_usage.flow_id
        service = None
        if resource_usage.service_name is not None:
            service = Service(
                service_name=resource_usage.service_name, instance_id=resource_usage.instance_id
            )
            method = Method(name=resource_usage.method_name)
        else:
            method = Method(name=resource_usage.method_name)
        resource_usage = ResourceUsage(service=service, method=method, usage=resource_usage.usage)
        await snapshot.add_resource_usage(flow_id, resource_usage)

    async def get_resource_usage(self, flow_id, snapshot: SnapshotStorage = None):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        return await snapshot.get_resource_usage(flow_id)

    async def get_flame_graph_data(self, flow_id, snapshot: SnapshotStorage = None):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flame_data = FlameGraphData(aggregated=[], parent_start_times=[])
        flame_graph_aggregated = await snapshot.get_flame_graph_data(flow_id)

        visited = {}
        for func_id, func_data in flame_graph_aggregated.items():
            if func_id in visited:
                total_in_parent = visited[func_id]
            else:
                total_in_parent = defaultdict(lambda: {"duration": 0, "count": 0})
            start_times = await snapshot.get_start_time(flow_id, func_id[0], func_id[1])
            for current_span_id, duration in func_data.durations.items():
                caller_infos = await snapshot.get_caller_info(flow_id, current_span_id)
                for caller_info in caller_infos:
                    caller_service = caller_info.service
                    caller_method = caller_info.method
                    if caller_service is not None:
                        caller_node_id = (
                            f"{caller_service.service_name}"
                            f":{caller_service.instance_id}.{caller_method.name}"
                        )
                    else:
                        caller_node_id = caller_method.name
                    total_in_parent[caller_node_id]["duration"] += duration
                    total_in_parent[caller_node_id]["count"] += 1
                    if "start_time" not in total_in_parent[caller_node_id]:
                        total_in_parent[caller_node_id]["start_time"] = start_times.get(
                            caller_node_id, 0
                        )
            visited[func_id] = total_in_parent
            service, method = func_id

            flame_data.aggregated.append(
                AggregatedFlameGraphData(
                    name=method.name
                    if service is None
                    else f"{service.service_name}:{service.instance_id}.{method.name}",
                    service_name="" if service is None else service.service_name,
                    value=func_data.total_time,
                    count=func_data.call_count,
                    total_in_parent=[
                        TotalInParent(
                            caller_node_id=k,
                            duration=v["duration"],
                            count=v["count"],
                            start_time=v["start_time"],
                        )
                        for k, v in total_in_parent.items()
                    ],
                )
            )

        parent_start_times = []
        start_times = await snapshot.get_start_times(flow_id)
        for callee_id, start_times in start_times.items():
            if callee_id not in visited:
                start_times = [
                    {
                        "caller_id": f"{service.service_name}:{service.instance_id}.{method.name}"
                        if service is not None
                        else method.name,
                        "start_time": v,
                    }
                    for (service, method), v in start_times.items()
                    if v > 0
                ]
                (callee_service, callee_method) = callee_id
                str_id = (
                    (
                        f"{callee_service.service_name}"
                        f":{callee_service.instance_id}.{callee_method.name}"
                    )
                    if callee_service is not None
                    else callee_method.name
                )
                parent_start_times.append(
                    ParentStartTimes(
                        callee_id=str_id,
                        start_times=start_times,
                    )
                )

        flame_data.parent_start_times = parent_start_times

        return flame_data

    async def emit_call_end(
        self, call_end: CallEndEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = call_end.flow_id
        target_service = (
            Service(service_name=call_end.target_service, instance_id=call_end.target_instance_id)
            if call_end.target_service is not None
            else None
        )
        target_method = Method(name=call_end.target_method)
        span_id = call_end.span_id
        await snapshot.del_debugger_info(flow_id, target_service, target_method, span_id)

        caller_infos = await snapshot.get_caller_info(flow_id, span_id)
        for caller_info in caller_infos:
            await snapshot.update_flow_record(
                flow_id,
                caller_info.service,
                caller_info.method,
                target_service,
                target_method,
                lambda record: record - 1,
            )

        duration = call_end.duration

        await snapshot.update_flame_graph_data(
            flow_id,
            target_service,
            target_method,
            lambda flame_data: FlameDataAggregated(
                total_time=flame_data.total_time + duration,
                call_count=flame_data.call_count + 1,
                durations={**flame_data.durations, span_id: duration},
                service_name=flame_data.service_name,
            ),
        )

    async def emit_debugger_info(
        self, debugger_info: DebuggerInfoEvent, snapshot: SnapshotStorage = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = debugger_info.flow_id
        service = (
            Service(service_name=debugger_info.service_name, instance_id=debugger_info.instance_id)
            if debugger_info.service_name
            else None
        )
        method = Method(name=debugger_info.method_name)
        debugger_host = debugger_info.debugger_host
        debugger_port = debugger_info.debugger_port
        debugger_enabled = debugger_info.debugger_enabled
        span_id = debugger_info.span_id
        await snapshot.set_debugger_info(
            flow_id,
            service,
            method,
            span_id,
            DebuggerInfo(
                debugger_host=debugger_host,
                debugger_port=debugger_port,
                debugger_enabled=debugger_enabled,
            ),
        )

    async def emit_call_begin(
        self, call_begin: CallBeginEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = call_begin.flow_id
        span_id = call_begin.span_id
        service = (
            Service(
                service_name=call_begin.source_service, instance_id=call_begin.source_instance_id
            )
            if call_begin.source_service
            else None
        )
        method = Method(name=call_begin.source_method)
        await snapshot.add_caller_info(flow_id, span_id, CallerInfo(service=service, method=method))

    async def emit_service_physical_stats(
        self,
        service_physical_stats: BatchServicePhysicalStatsEvent,
        snapshot: Optional[SnapshotStorage] = None,
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        flow_id = service_physical_stats.flow_id
        await snapshot.batch_add_service_physical_stats(flow_id, service_physical_stats.stats)

    async def emit_node_physical_stats(
        self, stats: BatchNodePhysicalStatsEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        await snapshot.batch_add_node_physical_stats(stats)

    async def emit_prompt(
        self, prompt: PromptRegisterEvent, snapshot: Optional[SnapshotStorage] = None
    ):
        if snapshot is None:
            snapshot = self._snapshots["latest"]
        await snapshot.set_prompt(prompt.prompt)
