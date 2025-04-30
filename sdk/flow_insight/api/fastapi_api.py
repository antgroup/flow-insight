import json
import logging
from typing import Any, Dict, List, Optional

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel as PydanticBaseModel

from flow_insight.api.base import APIInterface
from flow_insight.engine import Breakpoint, DebugCommand, InsightEngine
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
    RecordType,
    ResourceUsageEvent,
)
from flow_insight.storage.snapshot.base import StorageType

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
    def __init__(self, storage_type: StorageType = StorageType.MEMORY):
        super().__init__()
        self.engine = InsightEngine(storage_type)
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

        # Prompt routes
        self.app.get("/get_prompt")(self.get_prompt)
        self.app.get("/get_flow_creation_time")(self.get_flow_creation_time)

    async def run(self, host: str, port: int):
        """Run the HTTP server."""
        config = uvicorn.Config(self.app, host=host, port=port)
        server = uvicorn.Server(config)
        logger.info(f"Insight FastAPI server running at http://{host}:{port}")
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
        elif record_type == RecordType.PROMPT_REGISTER.value:
            record = PromptRegisterEvent(**record)
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
            sessions = await self.engine.get_debug_sessions(
                flow_id, service_name, instance_id, method_name, filter_active
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
            breakpoints = await self.engine.get_breakpoints(flow_id, span_id)
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
            breakpoints = [
                Breakpoint(line=bp["line"], source=bp["source"]) for bp in breakpoints_data
            ]
            result = await self.engine.set_breakpoints(flow_id, span_id, breakpoints)
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
            result = await self.engine.activate_debug_session(
                flow_id, service_name, instance_id, method_name, span_id
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
            snapshot = None
            if end_time is not None:
                snapshot = await self.engine.replay(flow_id, int(end_time))
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

        try:
            snapshot = None
            if end_time is not None:
                snapshot = await self.engine.replay(flow_id, int(end_time))
            flame_data = await self.engine.get_flame_graph_data(flow_id, snapshot)
            return JSONResponse(
                rest_response(
                    result=True,
                    msg="Flame graph data retrieved successfully.",
                    data=flame_data.model_dump(),
                )
            )
        except Exception as e:
            logger.error(f"Error retrieving flame graph data: {str(e)}")
            return JSONResponse(
                rest_response(result=False, msg=f"Error retrieving flame graph data: {str(e)}")
            )

    async def get_physical_view_data(self, request: Request) -> JSONResponse:
        """Get physical view data for visualization."""
        data = await self._parse_request(request)
        flow_id = data.get("flow_id", "")
        end_time = data.get("end_time", None)

        snapshot = None
        if end_time is not None:
            snapshot = await self.engine.replay(flow_id, int(end_time))
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
            snapshot = None
            if end_time is not None:
                snapshot = await self.engine.replay(flow_id, int(end_time))
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
            snapshot = None
            if end_time is not None:
                snapshot = await self.engine.replay(flow_id, int(end_time))
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
            prompt = await self.engine.get_prompt()
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
