# Flow Insight

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Flow Insight is an advanced visualization and debugging tool for distributed systems. It provides multiple views to analyze execution flow, resource usage, and performance metrics, along with powerful debugging capabilities and AI-powered analysis.

## 🚀 Features

- **Multiple Visualization Views** - Analyze your distributed system from different perspectives
- **Interactive Debugging** - Debug your application with an integrated debugging panel
- **AI-Powered Analysis** - Get intelligent insights about your system's behavior

## 📋 Table of Contents

- [Installation](#-installation)
- [Usage](#-usage)
- [Core Abstractions](#-core-abstractions)
- [Components](#-components)
- [Views](#-views)
- [SDK](#-sdk)
- [Documentation](#-documentation)
- [Contributing](#-contributing)

## 📥 Installation

### Prerequisites

- Node.js (v14 or later)
- npm or yarn
- Python 3.7+

### Frontend Installation

```bash
# Using npm
npm install @ant-ray/flow-insight

# Using yarn
yarn add @ant-ray/flow-insight
```

### Python SDK Installation

```bash
# From PyPI
pip install flow-insight

# From source
git clone https://github.com/antgroup/flow-insight.git
cd flow-insight/sdk
pip install -e .
```

## 🔧 Usage

### Frontend Component

```jsx
import { FlowInsight } from '@ant-ray/flow-insight';

function App() {
  return (
    <FlowInsight 
      baseUrl="https://your-api-endpoint.com"
      flowId="job-12345"
    />
  );
}
```

### Python SDK

```python
from flow_insight.client import InsightClient
from flow_insight.model import CallBeginEvent, CallEndEvent
from flow_insight.storage.persist.base import StorageType

# Initialize the client with server URL and storage type
client = InsightClient(server_url="http://your-insight-server:8000", 
                       storage_type=StorageType.MEMORY)

# Emit a call begin event
call_begin_event = CallBeginEvent(
    flow_id="job-12345",
    source_service="embedding_service",
    source_instance_id="worker-1",
    source_method="calculate_embeddings",
    parent_span_id="parent-span-123",
    span_id="span-456"
)
client.emit_event(call_begin_event)

# ... your code here ...

# Emit a call end event
call_end_event = CallEndEvent(
    flow_id="job-12345",
    target_service="embedding_service",
    target_instance_id="worker-1",
    target_method="calculate_embeddings",
    duration=0.235,
    span_id="span-456"
)
client.emit_event(call_end_event)

import asyncio

async def async_example():
    call_begin_event = CallBeginEvent(...)
    await client.async_emit_event(call_begin_event)
    # ... async code here ...
    call_end_event = CallEndEvent(...)
    await client.async_emit_event(call_end_event)
    await client.aclose()  # Close async client

# Remember to close the client when done
client.close()
```

## 🧩 Core Abstractions

Flow Insight uses the following core abstractions to model distributed systems:

### Services
- Stateful components with unique instance IDs
- Have associated resources (CPU, memory, GPU)
- Maintain state and process information
- Can have multiple instances with unique instance ids

### Methods
- RPC Functions belonging to services
- Associated with specific service instances

### Functions
- Stateless function runtime components


## 🔌 Components

### Frontend Components
- `FlowInsight` - Main component that wraps all visualization views

### SDK Components
- `InsightClient` - Client for sending telemetry data
- `FastAPIInsightServer` - Server component for collecting and storing telemetry
- Various event types and models for representing system state

## 🔍 Views

### Logical View

The logical view displays the call graph of your application, showing the relationships between services, methods, and functions. It visualizes call flows and data flows between components.

### Physical View

The physical view shows the physical deployment of your system, including:
- Node resources (CPU, memory, GPU)
- Service placement across nodes
- Resource usage and utilization

### Flame Graph View

The flame graph provides a hierarchical visualization of method calls of services, allowing you to:
- Identify performance bottlenecks
- Analyze execution time distribution
- Navigate through call stacks

### Distributed Stack View

The distributed stack view presents the execution stack of your distributed application, helping you understand the execution flow and dependencies.

### Debug Panel

The debug panel provides interactive debugging capabilities:
- View source code
- Step through execution
- Set breakpoints
- Inspect variables
- Control execution flow (continue, pause, step over, step into, step out)

### AI-Powered Analysis

Flow Insight includes an AI-powered analysis tool that:
- Generates comprehensive reports about your system
- Identifies potential issues and bottlenecks
- Provides optimization suggestions

## 🔧 SDK

The Flow Insight SDK provides Python libraries for instrumenting your distributed systems:

### Key Components

- **InsightClient**: Main client for sending telemetry data
  - Supports both synchronous and asynchronous API
  - Methods for recording various event types
  - Connection to different storage backends

- **FastAPIInsightServer**: FastAPI-based server for collecting and storing telemetry

### Client Methods

The `InsightClient` provides both synchronous and asynchronous methods:

#### Synchronous Methods
- `emit_event(event)`: Emit any supported event type (CallSubmitEvent, CallBeginEvent, CallEndEvent, etc.)
- `close()`: Close the client and release resources

#### Asynchronous Methods
- `async_emit_event(event)`: Asynchronously emit any supported event type
- `aclose()`: Asynchronously close the client and release resources

### Supported Event Types
- `CallSubmitEvent`: Record API call submission with flow_id, timestamps, and source/target details
- `CallBeginEvent`: Record the start of a method execution with span_id and parent_span_id for tracing
- `CallEndEvent`: Record the completion of a method execution with duration metrics
- `ObjectGetEvent`: Track object retrieval operations with receiver information
- `ObjectPutEvent`: Track object storage operations with size and sender information
- `ContextEvent`: Add contextual information to a flow or service
- `ResourceUsageEvent`: Track resource utilization (CPU, memory, etc.)
- `DebuggerInfoEvent`: Provide debugging information including host and port
- `BatchServicePhysicalStatsEvent`: Collect statistics across multiple services
- `BatchNodePhysicalStatsEvent`: Collect statistics across multiple nodes
- `PromptRegisterEvent`: Register prompt templates for AI components

### Storage Options

The SDK supports multiple storage backends:
- [x] In-memory storage for development
- [] Prometheus based Persistent storage for production

## 📚 Documentation

For comprehensive documentation, visit our [documentation site](https://antgroup.github.io/flowinsight).

## 👥 Contributing

We welcome contributions from the community! Please check out our [Contributing Guidelines](CONTRIBUTING.md) for more information on how to get started.

## 🙏 Acknowledgements

Thanks to all contributors who have helped make Flow Insight better!
