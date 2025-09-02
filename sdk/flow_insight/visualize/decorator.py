"""Method decorator for instrumenting functions and methods with flow insight events."""

import inspect
import sys
import time
import uuid
from functools import wraps
from typing import Any, Dict

from flow_insight.storage.snapshot.model import (
    CallBeginEvent,
    CallEndEvent,
    CallSubmitEvent,
    ObjectGetEvent,
    ObjectPutEvent,
)

from .client import get_insight_client

# Object tracking to emit OBJECT_GET/OBJECT_PUT events
_object_registry: Dict[str, Any] = {}
_object_counter: int = 0


# Global call context to maintain span hierarchy
class CallContext:
    """Thread-local call context for maintaining span hierarchy."""

    def __init__(self):
        self.span_stack = []
        self.flow_id = None

    def push_span(self, span_id: str, service_name: str, method_name: str):
        """Push a new span onto the stack."""
        self.span_stack.append(
            {"span_id": span_id, "service_name": service_name, "method_name": method_name}
        )

    def pop_span(self):
        """Pop the current span from the stack."""
        if self.span_stack:
            return self.span_stack.pop()
        return None

    def get_parent_span(self):
        """Get the parent span from the stack."""
        if len(self.span_stack) > 0:
            return self.span_stack[-1]
        return None

    def get_current_flow_id(self):
        """Get the current flow ID, creating one if needed."""
        if self.flow_id is None:
            self.flow_id = str(uuid.uuid4())
        return self.flow_id


# Thread-local storage for call context
import threading

_call_context = threading.local()


def get_call_context() -> CallContext:
    """Get the current call context."""
    if not hasattr(_call_context, "context"):
        _call_context.context = CallContext()
    return _call_context.context


def create_instrumented_method(original_method, service_name: str, method_name: str):
    """Create a synchronous instrumented method."""

    @wraps(original_method)
    def _flow_insight_instrumented_method(*args, **kwargs):
        client = get_insight_client()
        context = get_call_context()

        # Use configured flow_id from client if available, otherwise generate one
        client = get_insight_client()
        flow_id = client.flow_id if client.flow_id else context.get_current_flow_id()
        span_id = str(uuid.uuid4())
        timestamp = int(time.time() * 1000)

        # Get parent span from context
        parent_span = context.get_parent_span()
        parent_span_id = parent_span["span_id"] if parent_span else "_main"

        # Get caller information
        source_service, source_instance_id, source_method = _get_caller_info()

        # Emit CALL_SUBMIT event
        submit_event = CallSubmitEvent(
            flow_id=flow_id,
            parent_span_id=parent_span_id,
            source_service=source_service,
            source_instance_id=source_instance_id,
            source_method=source_method,
            target_service=service_name,
            target_instance_id=_get_target_instance_id(args),
            target_method=method_name,
            timestamp=timestamp,
        )
        client.emit_event(submit_event)

        # Emit both PUT and GET events for arguments (PUT from caller, GET for callee)
        target_instance_id = _get_target_instance_id(args)
        _emit_bidirectional_object_events(
            args,
            kwargs,
            flow_id,
            method_name,
            timestamp,
            source_service,
            source_instance_id,
            source_method,
            service_name,
            target_instance_id,
        )

        # Push current span to context
        context.push_span(span_id, service_name, method_name)

        # Emit CALL_BEGIN event
        begin_timestamp = int(time.time() * 1000)
        begin_event = CallBeginEvent(
            flow_id=flow_id,
            source_service=source_service,
            source_instance_id=source_instance_id,
            source_method=source_method,
            target_service=service_name,
            target_instance_id=_get_target_instance_id(args),
            target_method=method_name,
            parent_span_id=parent_span_id,
            span_id=span_id,
            timestamp=begin_timestamp,
        )
        client.emit_event(begin_event)

        try:
            # Call the original method
            result = original_method(*args, **kwargs)

            # Pop the current span from context
            context.pop_span()

            # Emit CALL_END event
            end_timestamp = int(time.time() * 1000)
            duration = (end_timestamp - begin_timestamp) / 1000.0

            end_event = CallEndEvent(
                flow_id=flow_id,
                target_service=service_name,
                target_instance_id=_get_target_instance_id(args),
                target_method=method_name,
                duration=duration,
                span_id=span_id,
                timestamp=end_timestamp,
            )
            client.emit_event(end_event)

            return result

        except Exception as e:
            # Pop the current span from context
            context.pop_span()

            # Emit CALL_END event with error
            end_timestamp = int(time.time() * 1000)
            duration = (end_timestamp - begin_timestamp) / 1000.0

            end_event = CallEndEvent(
                flow_id=flow_id,
                target_service=service_name,
                target_instance_id=_get_target_instance_id(args),
                target_method=method_name,
                duration=duration,
                span_id=span_id,
                timestamp=end_timestamp,
            )
            client.emit_event(end_event)
            raise

    return _flow_insight_instrumented_method


def _get_caller_info():
    """Get caller information from the call stack."""
    try:
        # Get the current frame and go up the stack
        frame = sys._getframe(2)

        # Initialize defaults
        source_service = None
        source_instance_id = None
        source_method = None

        # Get the code object
        if frame and frame.f_code:
            source_method = frame.f_code.co_name

            # Try to get the class name if this is a method
            if "self" in frame.f_locals:
                self_obj = frame.f_locals["self"]
                source_service = self_obj.__class__.__name__
                source_instance_id = str(id(self_obj))
            elif frame.f_globals and "__name__" in frame.f_globals:
                # This is a module-level function
                source_service = None
                source_instance_id = None  # Module-level functions don't have instances
                source_method = source_method
                if source_method == "<module>":
                    source_method = "_main"

        return source_service, source_instance_id, source_method

    except (ValueError, AttributeError):
        # Fallback if we can't get caller info
        return None, None, "unknown"


def _get_target_instance_id(args):
    """Get the target instance ID for the method being called."""
    if len(args) > 0 and hasattr(args[0], "__class__"):
        # This is a bound method (instance method)
        return str(id(args[0]))
    else:
        # This is a static method or standalone function
        return None


def _register_object(obj: Any) -> str:
    """Register an object and return a unique ID."""
    global _object_counter
    obj_id = f"obj_{id(obj)}_{_object_counter}"
    _object_counter += 1
    _object_registry[obj_id] = obj
    return obj_id


def _emit_bidirectional_object_events(
    args,
    kwargs,
    flow_id: str,
    method_name: str,
    timestamp: int,
    source_service: str,
    source_instance_id: str,
    source_method: str,
    target_service: str,
    target_instance_id: str,
):
    """Emit both OBJECT_PUT (from caller) and OBJECT_GET (to callee) events for arguments."""
    client = get_insight_client()
    # Use configured flow_id from client if available, otherwise use provided flow_id
    actual_flow_id = client.flow_id if client.flow_id else flow_id

    def _get_object_info(obj):
        """Get detailed object information."""
        try:
            size = sys.getsizeof(obj)
        except (TypeError, ValueError):
            size = 0

        obj_type = type(obj).__name__

        # Try to get string representation (truncate if too long)
        try:
            repr_str = str(obj)[:100]
        except Exception:
            repr_str = f"<{type(obj).__name__} object>"

        return {"size": size, "type": obj_type, "repr": repr_str}

    # Handle positional arguments
    for i, arg in enumerate(args):
        if arg is not None and not inspect.isclass(arg) and not callable(arg):
            obj_id = _register_object(arg)
            obj_info = _get_object_info(arg)

            # PUT event from caller
            put_event = ObjectPutEvent(
                flow_id=actual_flow_id,
                object_id=obj_id,
                object_size=obj_info["size"],
                object_pos=i,
                sender_service=source_service,
                sender_instance_id=source_instance_id,
                sender_method=source_method,
                timestamp=timestamp,
            )

            # GET event to callee
            get_event = ObjectGetEvent(
                flow_id=actual_flow_id,
                object_id=obj_id,
                receiver_service=target_service,
                receiver_instance_id=target_instance_id,
                receiver_method=method_name,
                timestamp=timestamp + 1,  # Slightly later to maintain order
            )

            client.emit_event(put_event)
            client.emit_event(get_event)

    # Handle keyword arguments
    for key, value in kwargs.items():
        if value is not None and not inspect.isclass(value) and not callable(value):
            obj_id = _register_object(value)
            obj_info = _get_object_info(value)

            # PUT event from caller
            put_event = ObjectPutEvent(
                flow_id=actual_flow_id,
                object_id=obj_id,
                object_size=obj_info["size"],
                object_pos=-1,  # Keyword args get -1
                sender_service=source_service,
                sender_instance_id=source_instance_id,
                sender_method=source_method,
                timestamp=timestamp,
            )

            # GET event to callee
            get_event = ObjectGetEvent(
                flow_id=flow_id,
                object_id=obj_id,
                receiver_service=target_service,
                receiver_instance_id=target_instance_id,
                receiver_method=method_name,
                timestamp=timestamp + 1,
            )

            client.emit_event(put_event)
            client.emit_event(get_event)


def instrument_module(module):
    """Convenience function to instrument a module."""
    from .registry import register_module

    register_module(module)
    return module
