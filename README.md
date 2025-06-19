# Flow Insight

[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Flow Insight is an advanced visualization and debugging tool for distributed systems. It provides multiple views to analyze execution flow, resource usage, and performance metrics with AI-powered analysis.

## 🚀 Features

- **Multiple Visualization Views** - Analyze your distributed system from different perspectives
- **Interactive Debugging** - Debug your application with an integrated debugging panel
- **AI-Powered Analysis** - Get intelligent insights about your system's behavior
- **Gantt Chart View** - Hierarchical timeline visualization with interactive debugging
- **Persist Backend** - Supporting disk persist backend

## 📋 Table of Contents

- [Installation](#-installation)
- [Usage](#-usage)
- [Core Abstractions](#-core-abstractions)
- [Components](#-components)
- [Views](#-views)
- [SDK](#-sdk)
- [Integrations](#-integrations)
- [Documentation](#-documentation)
- [Contributing](#-contributing)

## 📥 Installation

### Prerequisites
- Node.js & npm/yarn
- Python 3.7+

### Frontend
```bash
npm install @ant-ray/flow-insight
```

### Python SDK
```bash
pip install flow-insight
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
from flow_insight import InsightClient, CallBeginEvent, CallEndEvent

# Initialize client
client = InsightClient(server_url="http://your-insight-server")

# Emit events
call_begin_event = CallBeginEvent(
    flow_id="job-12345",
    source_service="embedding_service",
    span_id="span-456",
    timestamp=int(time.time()*1000)
)
client.emit_event(call_begin_event)

# Remember to close the client
client.close()
```

## 🧩 Core Abstractions

- **Services** - Stateful components with unique instance IDs and resources
- **Methods** - RPC Functions belonging to services  
- **Functions** - Stateless function runtime components

## 🔍 Views

- **Logical View** - Call graph showing relationships between services and methods
- **Physical View** - Physical deployment with node resources and service placement
- **Flame Graph View** - Hierarchical visualization of method calls for performance analysis
- **Gantt Chart View** - Interactive timeline visualization with hierarchical task breakdown, search/filter, expand/collapse, and comprehensive reporting
- **Distributed Stack View** - Execution stack of distributed applications
- **Debug Panel** - Interactive debugging with breakpoints and variable inspection
- **AI Analysis** - Automated system analysis with optimization suggestions

## 🔧 SDK

The Python SDK provides:

- **InsightClient** - Main client for sending telemetry (sync/async support)
- **FastAPIInsightServer** - Server component for data collection
- **Event Types** - CallSubmitEvent, CallBeginEvent, CallEndEvent, ResourceUsageEvent, etc.
- **Storage Options** - In-memory snapshots with disk persistence

## 🔗 Integrations

Flow Insight integrates with [Ray](https://ray.io) through [Ant-Ray](https://github.com/antgroup/ant-ray) for Ray application visualization and debugging.

## 🙏 Acknowledgements

Thanks to all contributors who have helped make Flow Insight better!
