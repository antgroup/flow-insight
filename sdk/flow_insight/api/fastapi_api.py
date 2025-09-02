import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel as PydanticBaseModel

from flow_insight.api.base import APIInterface
from flow_insight.engine import Breakpoint, DebugCommand, InsightEngine
from flow_insight.storage.snapshot.base import StorageType
from flow_insight.storage.snapshot.model import (
    BatchNodePhysicalStatsEvent,
    BatchServicePhysicalStatsEvent,
    CallBeginEvent,
    CallEndEvent,
    CallSubmitEvent,
    ContextEvent,
    DebuggerInfoEvent,
    MetaInfoRegisterEvent,
    ObjectGetEvent,
    ObjectPutEvent,
    RecordType,
    ResourceUsageEvent,
)

logger = logging.getLogger(__name__)


class RequestData(PydanticBaseModel):
    flow_id: str = ""
    span_id: str = ""
    service_name: Optional[str] = None
    instance_id: Optional[str] = None
    method_name: Optional[str] = None
    filter_active: bool = False
    stack_mode: bool = False
    command: str = ""
    args: Dict[str, Any] = {}
    breakpoints: List[Dict[str, Any]] = []
    record_type: str = ""
    record: Dict[str, Any] = {}


def rest_response(result: bool, msg: str, **kwargs) -> Dict[str, Any]:
    """Create a standardized REST response."""
    return {"result": result, "msg": msg, **kwargs}


class FastAPIInsightServer(APIInterface):
    def __init__(
        self,
        snapshot_storage_type: StorageType = StorageType.MEMORY,
        snapshot_duration_s: int = 60,
        storage_dir: str = "/tmp/flow_insight_snapshots",
    ):
        super().__init__()
        self.engine = InsightEngine(
            snapshot_storage_type=snapshot_storage_type,
            snapshot_duration_s=snapshot_duration_s,
            storage_dir=storage_dir,
        )
        self.app = FastAPI(title="Flow Insight API")
        self._setup_routes()

    def _setup_routes(self):
        # Debug session routes
        self.app.get("/get_debug_sessions")(self.get_debug_sessions)
        self.app.get("/get_breakpoints")(self.get_breakpoints)
        self.app.post("/set_breakpoints")(self.set_breakpoints)
        self.app.post("/activate_debug_session")(self.activate_debug_session)
        self.app.post("/deactivate_debug_session")(self.deactivate_debug_session)
        self.app.get("/get_active_debug_sessions")(self.get_active_debug_sessions)
        self.app.post("/debug_cmd")(self.debug_cmd)
        self.app.post("/emit")(self.emit_record)

        # Data visualization routes
        self.app.get("/get_call_graph_data")(self.get_call_graph_data)
        self.app.get("/get_flame_graph_data")(self.get_flame_graph_data)
        self.app.get("/get_physical_view_data")(self.get_physical_view_data)
        self.app.get("/get_context")(self.get_context)
        self.app.get("/get_resource_usage")(self.get_resource_usage)

        # Snapshot routes
        self.app.get("/list_snapshots")(self.list_snapshots)
        self.app.post("/create_snapshot")(self.create_snapshot)

        # Prompt routes
        self.app.get("/get_prompt")(self.get_prompt)
        self.app.get("/get_flow_creation_time")(self.get_flow_creation_time)

        # Ping route
        self.app.get("/ping")(self.ping)

        # Frontend serving
        self._setup_frontend_routes()

    async def run(self, host: str, port: int):
        """Run the HTTP server."""
        config = uvicorn.Config(self.app, host=host, port=port, access_log=False)
        server = uvicorn.Server(config)
        logger.info(f"Insight FastAPI server running at http://{host}:{port}")
        # Start periodic snapshot task
        asyncio.create_task(self.engine.periodic_snapshot())
        await server.serve()

    async def _parse_request(self, request: Request) -> Dict[str, Any]:
        """Parse request data from either query parameters or JSON body."""
        if request.method == "GET":
            return dict(request.query_params)
        else:
            try:
                return await request.json()
            except json.JSONDecodeError:
                return {}

    async def emit_record(self, request: Request) -> JSONResponse:
        """Emit a record."""
        data = await self._parse_request(request)
        record_type = data.get("record_type", "")
        record = data.get("record", {})
        if record_type == RecordType.CALL_SUBMIT.value:
            record = CallSubmitEvent(**record)
        elif record_type == RecordType.CALL_BEGIN.value:
            record = CallBeginEvent(**record)
        elif record_type == RecordType.CALL_END.value:
            record = CallEndEvent(**record)
        elif record_type == RecordType.OBJECT_GET.value:
            record = ObjectGetEvent(**record)
        elif record_type == RecordType.OBJECT_PUT.value:
            record = ObjectPutEvent(**record)
        elif record_type == RecordType.CONTEXT_ADD.value:
            record = ContextEvent(**record)
        elif record_type == RecordType.RESOURCE_USAGE_ADD.value:
            record = ResourceUsageEvent(**record)
        elif record_type == RecordType.DEBUGGER_INFO_ADD.value:
            record = DebuggerInfoEvent(**record)
        elif record_type == RecordType.SERVICE_PHYSICAL_STATS_ADD.value:
            record = BatchServicePhysicalStatsEvent(**record)
        elif record_type == RecordType.NODE_PHYSICAL_STATS_ADD.value:
            record = BatchNodePhysicalStatsEvent(**record)
        elif record_type == RecordType.META_INFO_REGISTER.value:
            record = MetaInfoRegisterEvent(**record)
        else:
            raise ValueError(f"Invalid record type: {record_type}")
        await self.engine.record_event(record)
        return JSONResponse(rest_response(result=True, msg="Record emitted successfully."))

    async def get_debug_sessions(self, request: Request) -> JSONResponse:
        """Get debug sessions for a flow."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        service_name = data.get("service_name", None)
        instance_id = data.get("instance_id", None)
        method_name = data.get("method_name", None)
        filter_active = data.get("filter_active", "false") == "true"

        try:
            snapshot = await self.engine.get_snapshot_by_label("latest")
            sessions = await self.engine.get_debug_sessions(
                flow_id, service_name, instance_id, method_name, filter_active, snapshot
            )
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Debug sessions retrieved successfully.",
                    data=[session.model_dump() for session in sessions],
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving debug sessions: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving debug sessions: {str(e)}")
            )

    async def get_breakpoints(self, request: Request) -> JSONResponse:
        """Get breakpoints for a debug session."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        span_id = data.get("span_id", "")

        try:
            snapshot = await self.engine.get_snapshot_by_label("latest")
            breakpoints = await self.engine.get_breakpoints(flow_id, span_id, snapshot)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Breakpoints retrieved successfully.",
                    data=[bp.model_dump() for bp in breakpoints],
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving breakpoints: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving breakpoints: {str(e)}")
            )

    async def set_breakpoints(self, request: Request) -> JSONResponse:
        """Set breakpoints for a debug session."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        span_id = data.get("span_id", "")
        breakpoints_data = data.get("breakpoints", [])

        try:
            snapshot = await self.engine.get_snapshot_by_label("latest")
            breakpoints = [
                Breakpoint(line=bp["line"], source=bp["sourceFile"]) for bp in breakpoints_data
            ]
            result = await self.engine.set_breakpoints(flow_id, span_id, breakpoints, snapshot)
            return JSONResponse(
                rest_response(result=True, msg="Breakpoints set successfully.", data=result)
            )
        except Exception as e:
            logger.error(f"Error setting breakpoints: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error setting breakpoints: {str(e)}")
            )

    async def activate_debug_session(self, request: Request) -> JSONResponse:
        """Activate a debug session."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "default_job")
        service_name = data.get("service_name", None)
        instance_id = data.get("instance_id", None)
        method_name = data.get("method_name")
        span_id = data.get("span_id", "")

        try:
            snapshot = await self.engine.get_snapshot_by_label("latest")
            result = await self.engine.activate_debug_session(
                flow_id, service_name, instance_id, method_name, span_id, snapshot
            )
            return JSONResponse(
                rest_response(result=True, msg="Debug session activated successfully.", data=result)
            )
        except Exception as e:
            logger.error(f"Error activating debug session: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error activating debug session: {str(e)}")
            )

    async def debug_cmd(self, request: Request) -> JSONResponse:
        """Send a debug command."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        span_id = data.get("span_id", "")
        command_str = data.get("command", "")
        args = data.get("args", {})

        try:
            command = DebugCommand(command_str)
            result = await self.engine.debug_cmd(flow_id, span_id, command, args)
            return JSONResponse(
                rest_response(result=True, msg="Debug command executed successfully.", data=result)
            )
        except Exception as e:
            logger.error(f"Error executing debug command: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error executing debug command: {str(e)}")
            )

    async def deactivate_debug_session(self, request: Request) -> JSONResponse:
        """Deactivate a debug session."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        span_id = data.get("span_id", "")

        try:
            await self.engine.deactivate_debug_session(flow_id, span_id)
            return JSONResponse(
                rest_response(result=True, msg="Debug session deactivated successfully.")
            )
        except Exception as e:
            logger.error(f"Error deactivating debug session: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error deactivating debug session: {str(e)}")
            )

    async def get_active_debug_sessions(self, request: Request) -> JSONResponse:
        """Get active debug sessions."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")

        try:
            active_sessions = await self.engine.get_active_debug_sessions(flow_id)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Active debug sessions retrieved successfully.",
                    data=active_sessions,
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving active debug sessions: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving active debug sessions: {str(e)}")
            )

    async def get_call_graph_data(self, request: Request) -> JSONResponse:
        """Get call graph data for visualization."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        stack_mode = data.get("stack_mode", "false") == "true"
        end_time = data.get("end_time", None)

        try:
            if end_time:
                # Try to find a snapshot close to the requested time
                snapshots = await self.engine.list_snapshots(flow_id)
                best_snapshot = None
                end_time_int = int(end_time)

                for snapshot_info in snapshots:
                    if snapshot_info["timestamp"] <= end_time_int:
                        best_snapshot = snapshot_info["label"]
                        break

                if best_snapshot:
                    snapshot = await self.engine.get_snapshot_by_label(best_snapshot)
                else:
                    snapshot = await self.engine.get_snapshot_by_label("latest")
            else:
                snapshot = await self.engine.get_snapshot_by_label("latest")

            graph_data = await self.engine.get_call_graph_data(flow_id, stack_mode, snapshot)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Call graph data retrieved successfully.",
                    data=graph_data.model_dump(),
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving call graph data: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving call graph data: {str(e)}")
            )

    async def get_flame_graph_data(self, request: Request) -> JSONResponse:
        """Get flame graph data for visualization."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        end_time = data.get("end_time", None)

        if end_time:
            # Try to find a snapshot close to the requested time
            snapshots = await self.engine.list_snapshots(flow_id)
            best_snapshot = None
            end_time_int = int(end_time)

            for snapshot_info in snapshots:
                if snapshot_info["timestamp"] <= end_time_int:
                    best_snapshot = snapshot_info["label"]
                    break

            if best_snapshot:
                snapshot = await self.engine.get_snapshot_by_label(best_snapshot)
            else:
                snapshot = await self.engine.get_snapshot_by_label("latest")
        else:
            snapshot = await self.engine.get_snapshot_by_label("latest")

        flame_data = await self.engine.get_flame_graph_data(flow_id, snapshot)
        return JSONResponse(
            rest_response(
                result=True,
                msg="Flame graph data retrieved successfully.",
                data=flame_data.model_dump(),
            )
        )

    async def get_physical_view_data(self, request: Request) -> JSONResponse:
        """Get physical view data for visualization."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        end_time = data.get("end_time", None)

        if end_time:
            # Try to find a snapshot close to the requested time
            snapshots = await self.engine.list_snapshots(flow_id)
            best_snapshot = None
            end_time_int = int(end_time)

            for snapshot_info in snapshots:
                if snapshot_info["timestamp"] <= end_time_int:
                    best_snapshot = snapshot_info["label"]
                    break

            if best_snapshot:
                snapshot = await self.engine.get_snapshot_by_label(best_snapshot)
            else:
                snapshot = await self.engine.get_snapshot_by_label("latest")
        else:
            snapshot = await self.engine.get_snapshot_by_label("latest")

        physical_view_data = await self.engine.get_physical_view_data(flow_id, snapshot)
        return JSONResponse(
            rest_response(
                result=True,
                msg="Physical view data retrieved successfully.",
                data=physical_view_data.model_dump(),
            )
        )

    async def get_context(self, request: Request) -> JSONResponse:
        """Get the context."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        end_time = data.get("end_time", None)

        try:
            if end_time:
                # Try to find a snapshot close to the requested time
                snapshots = await self.engine.list_snapshots(flow_id)
                best_snapshot = None
                end_time_int = int(end_time)

                for snapshot_info in snapshots:
                    if snapshot_info["timestamp"] <= end_time_int:
                        best_snapshot = snapshot_info["label"]
                        break

                if best_snapshot:
                    snapshot = await self.engine.get_snapshot_by_label(best_snapshot)
                else:
                    snapshot = await self.engine.get_snapshot_by_label("latest")
            else:
                snapshot = await self.engine.get_snapshot_by_label("latest")

            context = await self.engine.get_context(flow_id, snapshot)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Context retrieved successfully.",
                    data=[c.model_dump() for c in context],
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving context: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving context: {str(e)}")
            )

    async def get_resource_usage(self, request: Request) -> JSONResponse:
        """Get the resource usage."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        end_time = data.get("end_time", None)

        try:
            if end_time:
                # Try to find a snapshot close to the requested time
                snapshots = await self.engine.list_snapshots(flow_id)
                best_snapshot = None
                end_time_int = int(end_time)

                for snapshot_info in snapshots:
                    if snapshot_info["timestamp"] <= end_time_int:
                        best_snapshot = snapshot_info["label"]
                        break

                if best_snapshot:
                    snapshot = await self.engine.get_snapshot_by_label(best_snapshot)
                else:
                    snapshot = await self.engine.get_snapshot_by_label("latest")
            else:
                snapshot = await self.engine.get_snapshot_by_label("latest")

            resource_usage = await self.engine.get_resource_usage(flow_id, snapshot)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Resource usage retrieved successfully.",
                    data=[r.model_dump() for r in resource_usage],
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving resource usage: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving resource usage: {str(e)}")
            )

    async def get_prompt(self, request: Request) -> JSONResponse:
        """Get the prompt."""
        try:
            snapshot = await self.engine.get_snapshot_by_label("latest")
            prompt = await self.engine.get_prompt(snapshot)
            return JSONResponse(
                rest_response(result=True, msg="Prompt retrieved successfully.", data=prompt)
            )
        except Exception as e:
            logger.error(f"Error retrieving prompt: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving prompt: {str(e)}")
            )

    async def get_flow_creation_time(self, request: Request) -> JSONResponse:
        """Get the flow creation time."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        return JSONResponse(
            rest_response(
                result=True,
                msg="Flow creation time retrieved successfully.",
                data=await self.engine.get_flow_creation_time(flow_id),
            )
        )

    async def ping(self, request: Request) -> JSONResponse:
        """Ping the server."""
        return JSONResponse(rest_response(result=True, msg="Pong"))

    async def list_snapshots(self, request: Request) -> JSONResponse:
        """List all snapshots for a flow."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", None)

        try:
            snapshots = await self.engine.list_snapshots(flow_id)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Snapshots retrieved successfully.",
                    data=snapshots,
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving snapshots: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving snapshots: {str(e)}")
            )

    async def create_snapshot(self, request: Request) -> JSONResponse:
        """Create a new snapshot for a flow."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        label = data.get("label", None)

        try:
            snapshot_label = await self.engine.create_snapshot(flow_id, label)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Snapshot created successfully.",
                    data={"label": snapshot_label},
                )
            )
        except Exception as e:
            logger.error(f"Error creating snapshot: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error creating snapshot: {str(e)}")
            )

    def _setup_frontend_routes(self):
        """Setup routes for serving the frontend."""
        import os

        import flow_insight

        # Get the directory where flow_insight package is installed
        package_dir = os.path.dirname(flow_insight.__file__)
        frontend_dir = os.path.join(package_dir, "frontend", "dist")
        self.app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")


def create_app():
    """Create a FastAPI application instance."""
    server = FastAPIInsightServer()
    return server.app
