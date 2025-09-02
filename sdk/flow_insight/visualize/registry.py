"""Module registration system for Flow Insight visualization."""

import inspect
import types
from typing import Any, Dict

from flow_insight.visualize.decorator import create_instrumented_method

# Registry to track instrumented modules and their original methods
_instrumented_modules: Dict[str, Dict[str, Any]] = {}


def register_module(module: types.ModuleType, module_name: str = None) -> None:
    """Register a module for automatic instrumentation.

    Args:
        module: The module to instrument
        module_name: Optional name for the module. If None, uses module.__name__
    """
    if module_name is None:
        module_name = module.__name__

    if module_name in _instrumented_modules:
        return  # Already instrumented

    # Store original methods for restoration
    _instrumented_modules[module_name] = {"module": module, "original_methods": {}}

    # Instrument all classes and functions in the module
    _instrument_module_contents(module, module_name)


def unregister_module(module_name: str) -> None:
    """Unregister a module and restore original methods.

    Args:
        module_name: Name of the module to unregister
    """
    if module_name not in _instrumented_modules:
        return

    module_info = _instrumented_modules[module_name]
    module = module_info["module"]

    # Restore original methods
    for name, original_func in module_info["original_methods"].items():
        setattr(module, name, original_func)

    # Restore class methods
    for name, obj in inspect.getmembers(module):
        if inspect.isclass(obj):
            for method_name, original_method in (
                module_info["original_methods"].get(name, {}).items()
            ):
                setattr(obj, method_name, original_method)

    del _instrumented_modules[module_name]


def _instrument_module_contents(module: types.ModuleType, module_name: str) -> None:
    """Instrument all classes and functions within a module."""

    for name, obj in inspect.getmembers(module):
        if inspect.isclass(obj):
            # Instrument class methods
            _instrument_class(obj, module_name)
        elif inspect.isfunction(obj) and obj.__module__ == module.__name__:
            # Instrument module-level functions
            _instrument_function(module, name, obj, module_name)


def _instrument_class(cls: type, module_name: str) -> None:
    """Instrument all methods in a class."""

    module_info = _instrumented_modules[module_name]
    cls_name = cls.__name__

    if cls_name not in module_info["original_methods"]:
        module_info["original_methods"][cls_name] = {}

    for method_name, _ in inspect.getmembers(cls, inspect.isfunction):
        if not method_name.startswith("_"):  # Skip private methods
            original_method = getattr(cls, method_name)
            module_info["original_methods"][cls_name][method_name] = original_method

            service_name = f"{cls_name}"
            instrumented_method = create_instrumented_method(
                original_method, service_name, method_name
            )
            setattr(cls, method_name, instrumented_method)


def _instrument_function(
    module: types.ModuleType, func_name: str, func: Any, module_name: str
) -> None:
    """Instrument a module-level function."""

    module_info = _instrumented_modules[module_name]

    instrumented_func = create_instrumented_method(func, None, func_name)

    module_info["original_methods"][func_name] = func
    setattr(module, func_name, instrumented_func)


def get_instrumented_modules() -> Dict[str, Dict[str, Any]]:
    """Get information about currently instrumented modules."""
    return _instrumented_modules.copy()
