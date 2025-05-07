import asyncio
import sys
from typing import Optional
import logging
import random
import time
import uuid
import traceback
from pathlib import Path

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from flow_insight import FastAPIInsightServer
from flow_insight import InsightClient
from flow_insight import (
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
)
from flow_insight import BatchNodePhysicalStats, ServicePhysicalStatsRecord
from flow_insight.storage.snapshot.base import StorageType as SnapshotStorageType
from flow_insight.storage.persist.base import StorageType as PersistStorageType
from flow_insight import (
    DeviceInfo,
    DeviceType,
    MemoryInfo,
    NodeMemoryInfo,
    NodePhysicalStats,
    NodeResourceUsage,
    Service,
    ServicePhysicalStats,
    ServiceState,
    UsageModel,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

HOST = "0.0.0.0"
PORT = 8000

# Define the simulated cluster topology
CLUSTER_CONFIG = {
    "nodes": [
        {"id": "node-1", "cpu_cores": 16, "memory_total": 32 * 1024 * 1024 * 1024, "gpus": 2},
        {"id": "node-2", "cpu_cores": 32, "memory_total": 64 * 1024 * 1024 * 1024, "gpus": 4},
        {"id": "node-3", "cpu_cores": 8, "memory_total": 16 * 1024 * 1024 * 1024, "gpus": 0}
    ],
    "services": [
        {"name": "api-gateway", "instances": 2, "node": "node-1", "methods": ["process_request", "authenticate", "route"]},
        {"name": "auth-service", "instances": 1, "node": "node-1", "methods": ["verify_token", "generate_token"]},
        {"name": "data-processor", "instances": 3, "node": "node-2", "methods": ["process_batch", "aggregate", "transform"]},
        {"name": "model-serving", "instances": 2, "node": "node-2", "methods": ["predict", "batch_predict", "explain"]},
        {"name": "storage-service", "instances": 1, "node": "node-3", "methods": ["read", "write", "delete"]}
    ]
}

async def simulate_call_chain(client, flow_id, event_count):
    """Simulate a call chain across multiple services"""
    try:
        # Choose a random starting service and method
        start_service = random.choice(CLUSTER_CONFIG["services"])
        service_name = start_service["name"]
        instance_id = f"{service_name}-{random.randint(0, start_service['instances']-1)}"
        method_name = random.choice(start_service["methods"])
        
        # Generate a unique span ID for this call chain
        parent_span_id = f"root-{event_count}"
        current_span_id = f"span-{event_count}-1"
        
        
        # Submit the first call
        submit_event = CallSubmitEvent(
            flow_id=flow_id,
            parent_span_id=parent_span_id,
            source_service=service_name,
            source_instance_id=instance_id,
            source_method=method_name,
            target_service=service_name,
            target_instance_id=instance_id,
            target_method=method_name,
            timestamp=int(time.time()*1000)
        )
        await client.async_emit_event(submit_event)
        
        # Begin the first call
        begin_event = CallBeginEvent(
            flow_id=flow_id,
            source_service=service_name,
            source_instance_id=instance_id,
            source_method=method_name,
            parent_span_id=parent_span_id,
            span_id=current_span_id,
            timestamp=int(time.time()*1000)
        )
        await client.async_emit_event(begin_event)
        
        # Add context information
        context_event = ContextEvent(
            flow_id=flow_id,
            service_name=service_name,
            instance_id=instance_id,
            method_name=method_name,
            context={"request_id": str(uuid.uuid4()), "user_id": f"user-{random.randint(1, 1000)}", "timestamp": int(time.time()*1000)},
            timestamp=int(time.time()*1000)
        )
        await client.async_emit_event(context_event)
        
        # Add resource usage information
        resource_event = ResourceUsageEvent(
            flow_id=flow_id,
            service_name=service_name,
            instance_id=instance_id,
            method_name=method_name,
            usage={
                "cpu": UsageModel(used=random.uniform(0.1, 50), base="percent"),
                "memory": UsageModel(used=random.uniform(50, 500), base="MB"),
                "disk_io": UsageModel(used=random.uniform(0.5, 10), base="MB/s")
            },
            timestamp=int(time.time()*1000)
        )
        await client.async_emit_event(resource_event)
        
        # Simulate making 0-3 nested calls
        num_nested_calls = random.randint(0, 3)
        child_span_ids = []
        
        for i in range(num_nested_calls):
            # Choose a random target service and method
            target_service = random.choice(CLUSTER_CONFIG["services"])
            target_service_name = target_service["name"]
            target_instance_id = f"{target_service_name}-{random.randint(0, target_service['instances']-1)}"
            target_method_name = random.choice(target_service["methods"])
            
            child_span_id = f"span-{event_count}-{i+2}"
            child_span_ids.append(child_span_id)
            
            # Put some object data before the call
            object_id = f"obj-{event_count}-{i}"
            object_size = random.randint(1024, 10*1024*1024)  # 1KB to 10MB
            
            put_event = ObjectPutEvent(
                flow_id=flow_id,
                object_id=object_id,
                object_size=object_size,
                object_pos=i,
                sender_service=service_name,
                sender_instance_id=instance_id,
                sender_method=method_name,
                timestamp=int(time.time()*1000)
            )
            await client.async_emit_event(put_event)
            
            # Submit the nested call
            nested_submit = CallSubmitEvent(
                flow_id=flow_id,
                parent_span_id=current_span_id,
                source_service=service_name,
                source_instance_id=instance_id,
                source_method=method_name,
                target_service=target_service_name,
                target_instance_id=target_instance_id,
                target_method=target_method_name,
                timestamp=int(time.time()*1000)
            )
            await client.async_emit_event(nested_submit)
            
            # Begin the nested call
            nested_begin = CallBeginEvent(
                flow_id=flow_id,
                source_service=target_service_name,
                source_instance_id=target_instance_id,
                source_method=target_method_name,
                parent_span_id=current_span_id,
                span_id=child_span_id,
                timestamp=int(time.time()*1000)
            )
            await client.async_emit_event(nested_begin)
            
            # Get the object in the target service
            get_event = ObjectGetEvent(
                flow_id=flow_id,
                object_id=object_id,
                receiver_service=target_service_name,
                receiver_instance_id=target_instance_id,
                receiver_method=target_method_name,
                timestamp=int(time.time() * 1000)
            )
            await client.async_emit_event(get_event)
            
            # Add debugger info occasionally
            if random.random() < 0.2:  # 20% chance
                debugger_event = DebuggerInfoEvent(
                    flow_id=flow_id,
                    service_name=target_service_name,
                    instance_id=target_instance_id,
                    method_name=target_method_name,
                    span_id=child_span_id,
                    debugger_host="localhost",
                    debugger_port=9000 + random.randint(0, 999),
                    debugger_enabled=True,
                    timestamp=int(time.time() * 1000)
                )
                await client.async_emit_event(debugger_event)
            
            # Simulate processing time in the nested call
            await asyncio.sleep(random.uniform(10, 20))
            
            # End the nested call
            nested_end = CallEndEvent(
                flow_id=flow_id,
                target_service=target_service_name,
                target_instance_id=target_instance_id,
                target_method=target_method_name,
                span_id=child_span_id,
                duration=random.uniform(50, 500),
                timestamp=int(time.time()*1000)
            )
            await client.async_emit_event(nested_end)
        
        # Simulate more processing time in the main call
        await asyncio.sleep(random.uniform(10, 20))
        
        # End the main call
        end_event = CallEndEvent(
            flow_id=flow_id,
            target_service=service_name,
            target_instance_id=instance_id,
            target_method=method_name,
            span_id=current_span_id,
            duration=random.uniform(100, 1000),
            timestamp=int(time.time()*1000)
        )
        await client.async_emit_event(end_event)
        
        return service_name, instance_id, child_span_ids
    except Exception as e:
        logger.error(f"Exception in simulate_call_chain: {str(e)}")
        logger.error(traceback.format_exc())
        raise  # Re-raise the exception after logging it

async def emit_node_physical_stats(client):
    """Emit node physical stats periodically"""
    while True:
        try:
            node_stats_list = []
            
            for node in CLUSTER_CONFIG["nodes"]:
                node_id = node["id"]
                cpu_cores = node["cpu_cores"]
                memory_total = node["memory_total"]
                memory_available = int(memory_total * (0.3 + 0.4 * random.random()))  # 30-70% available
                memory_used = memory_total - memory_available
                
                # Create GPU device information if the node has GPUs
                gpu_devices = []
                for i in range(node["gpus"]):
                    gpu_memory_total = 16 * 1024 * 1024 * 1024  # 16GB
                    gpu_memory_used = int(gpu_memory_total * random.uniform(0.1, 0.9))
                    gpu_device = DeviceInfo(
                        index=i,
                        name=f"NVIDIA RTX A6000 {i}",
                        uuid=f"GPU-{uuid.uuid4()}",
                        memory_total=gpu_memory_total,
                        memory_used=gpu_memory_used,
                        utilization=random.uniform(5, 95)
                    )
                    gpu_devices.append(gpu_device)
                
                # Create node stats
                node_stats = NodePhysicalStats(
                    node_id=node_id,
                    devices={DeviceType.GPU: gpu_devices} if gpu_devices else {},
                    resources={
                        "cpu": NodeResourceUsage(
                            total=cpu_cores,
                            available=cpu_cores * (0.2 + 0.6 * random.random())  # 20-80% available
                        ),
                        "memory": NodeResourceUsage(
                            total=memory_total,
                            available=memory_available
                        )
                    },
                    cpu_percent=random.uniform(10, 90),
                    memory_info=NodeMemoryInfo(
                        total=memory_total,
                        available=memory_available,
                        used=memory_used
                    )
                )
                node_stats_list.append(node_stats)
            
            # Create batch node physical stats
            batch_stats = BatchNodePhysicalStats(stats=node_stats_list)
            event = BatchNodePhysicalStatsEvent(stats=batch_stats, timestamp=int(time.time()*1000))
            await client.async_emit_event(event)
            
            await asyncio.sleep(50)  # Update every 5 seconds
        except Exception as e:
            logger.error(f"Exception in emit_node_physical_stats: {str(e)}")
            logger.error(traceback.format_exc())
            await asyncio.sleep(5)  # Continue after error, but wait a bit

async def emit_service_physical_stats(client, flow_id):
    """Emit service physical stats periodically"""
    while True:
        try:
            service_stats_list = []
            
            for service_config in CLUSTER_CONFIG["services"]:
                service_name = service_config["name"]
                node_id = service_config["node"]
                
                # Get the node configuration to check for GPUs
                node_config = next((node for node in CLUSTER_CONFIG["nodes"] if node["id"] == node_id), None)
                if not node_config:
                    continue
                    
                # Number of GPUs available on this node
                num_gpus = node_config["gpus"]
                
                for i in range(service_config["instances"]):
                    instance_id = f"{service_name}-{i}"
                    
                    # Create memory info
                    rss = random.randint(50 * 1024 * 1024, 1024 * 1024 * 1024)  # 50MB to 1GB
                    memory_info = MemoryInfo(
                        rss=rss,
                        vms=rss * 2,
                        shared=int(rss * 0.3),
                        text=int(rss * 0.1),
                        lib=int(rss * 0.05),
                        data=int(rss * 0.4),
                        dirty=int(rss * 0.05)
                    )
                    
                    state = ServiceState.RUNNING
                    
                    # Assign GPU devices to services that might need them
                    # Especially for model-serving and data-processor services
                    devices = {}
                    if num_gpus > 0 and service_name in ["model-serving", "data-processor"]:
                        # Determine how many GPUs this service instance uses (1 or 2)
                        service_gpu_count = min(num_gpus, 2 if service_name == "model-serving" else 1)
                        
                        gpu_devices = []
                        for j in range(service_gpu_count):
                            # Pick a GPU index from the available ones on the node
                            gpu_idx = j % num_gpus
                            
                            gpu_memory_total = 16 * 1024 * 1024 * 1024  # 16GB
                            gpu_memory_used = int(gpu_memory_total * random.uniform(0.1, 0.9))
                            
                            gpu_device = DeviceInfo(
                                index=gpu_idx,
                                name=f"NVIDIA RTX A6000 {gpu_idx}",
                                uuid=f"GPU-{uuid.uuid4()}",
                                memory_total=gpu_memory_total,
                                memory_used=gpu_memory_used,
                                utilization=random.uniform(5, 95) if service_name == "model-serving" else random.uniform(10, 50)
                            )
                            gpu_devices.append(gpu_device)
                        
                        if gpu_devices:
                            devices[DeviceType.GPU] = gpu_devices
                    
                    # Create service physical stats
                    service_physical_stats = ServicePhysicalStats(
                        node_id=node_id,
                        pid=10000,
                        state=state,
                        required_resources={
                            "cpu": 2.0, 
                            "memory": 2.0 * 1024 * 1024 * 1024,
                            "gpu": 1.0 if service_name in ["model-serving", "data-processor"] and num_gpus > 0 else 0.0
                        },
                        placement_id=f"placement-{uuid.uuid4()}",
                        cpu_percent=10,
                        memory_info=memory_info,
                        devices=devices
                    )
                    
                    # Create service record
                    service = Service(service_name=service_name, instance_id=instance_id)
                    service_stats_record = ServicePhysicalStatsRecord(
                        service=service,
                        stats=service_physical_stats
                    )
                    
                    service_stats_list.append(service_stats_record)
            
            # Create batch service physical stats event
            batch_stats_event = BatchServicePhysicalStatsEvent(
                flow_id=flow_id,
                stats=service_stats_list,
                timestamp=int(time.time()*1000)
            )
            await client.async_emit_event(batch_stats_event)
            
            await asyncio.sleep(5)  # Update every 5 seconds
        except Exception as e:
            logger.error(f"Exception in emit_service_physical_stats: {str(e)}")
            logger.error(traceback.format_exc())
            await asyncio.sleep(5)  # Continue after error, but wait a bit

async def emit_prompt_register(client):
    """Emit a prompt register event occasionally"""
    while True:
        try:
            prompts = [
                "Create a visualization of the system performance metrics.",
                "Analyze the resource usage patterns across all services.",
                "Identify potential bottlenecks in the distributed system.",
                "Generate a report summarizing the flow execution statistics.",
                "Explain the observed latency spikes in the data processing pipeline."
            ]
            
            prompt_event = PromptRegisterEvent(prompt=random.choice(prompts), timestamp=int(time.time()*1000))
            await client.async_emit_event(prompt_event)
            
            await asyncio.sleep(30)  # Register a new prompt every 30 seconds
        except Exception as e:
            logger.error(f"Exception in emit_prompt_register: {str(e)}")
            logger.error(traceback.format_exc())
            await asyncio.sleep(5)  # Continue after error, but wait a bit

async def emit_demo_events(client):
    """Emit demo events in a loop"""
    flow_id = "demo-flow"
    event_count = 0
    
    # Start tasks for emitting physical stats
    node_stats_task = asyncio.create_task(emit_node_physical_stats(client))
    service_stats_task = asyncio.create_task(emit_service_physical_stats(client, flow_id))
    prompt_task = asyncio.create_task(emit_prompt_register(client))
    
    try:
        while True:
            try:
                # Simulate a complete call chain
                await simulate_call_chain(client, flow_id, event_count)
                
                event_count += 1
                await asyncio.sleep(random.uniform(10, 20))  # Random delay between call chains
            except Exception as e:
                logger.error(f"Exception in emit_demo_events main loop: {str(e)}")
                logger.error(traceback.format_exc())
                await asyncio.sleep(5)  # Continue after error, but wait a bit
    finally:
        # Cancel background tasks
        node_stats_task.cancel()
        service_stats_task.cancel()
        prompt_task.cancel()

async def setup_and_run_server(opentsdb_url: Optional[str] = None):
    # Create the FastAPI server
    if opentsdb_url is not None:
        server = FastAPIInsightServer(snapshot_storage_type=SnapshotStorageType.MEMORY, persist_storage_type=PersistStorageType.INFLUXDB, persist_storage_config={"server_url": opentsdb_url, "username": "nodered", "password": "nodered"})
    else:
        server = FastAPIInsightServer(snapshot_storage_type=SnapshotStorageType.MEMORY, persist_storage_type=PersistStorageType.DISK, persist_storage_config={"storage_dir": ".flow_insight/events"})
    
    # Mount the frontend static files
    frontend_dir = Path(__file__).parent.parent / "frontend" / "example" / "dist"
    if frontend_dir.exists():
        server.app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
    else:
        logger.warning(f"Frontend directory not found at {frontend_dir}")
    
    # Add CORS middleware
    server.app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Create a client to emit events
    if opentsdb_url is not None:
        client = InsightClient(opentsdb_url, PersistStorageType.INFLUXDB, {"username": "nodered", "password": "nodered"})
    else:
        client = InsightClient(f"http://localhost:{PORT}", PersistStorageType.DISK)
    
    # Start emitting events in the background
    emit_task = None
    
    try:
        # Start emitting events
        emit_task = asyncio.create_task(emit_demo_events(client))
        
        # Run the server
        await server.run(host=HOST, port=PORT)
    except Exception as e:
        logger.error(f"Server exception: {str(e)}")
        logger.error(traceback.format_exc())
    finally:
        # Clean up
        if emit_task:
            emit_task.cancel()
        await client.aclose()

if __name__ == "__main__":
    print(f"Starting Flow Insight demo server at http://{HOST}:{PORT}")
    try:
        asyncio.run(setup_and_run_server(sys.argv[1] if len(sys.argv) > 1 else None))
    except Exception as e:
        logger.error(f"Fatal exception: {str(e)}")
        logger.error(traceback.format_exc()) 
