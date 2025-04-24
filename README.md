# Flow Insight

Flow Insight is an advanced visualization and debugging tool for distributed systems. It provides multiple views to analyze execution flow, resource usage, and performance metrics, along with powerful debugging capabilities and AI-powered analysis.

## Features

- **Multiple Visualization Views** - Analyze your distributed system from different perspectives
- **Interactive Debugging** - Debug your application with an integrated debugging panel
- **AI-Powered Analysis** - Get intelligent insights about your system's behavior

## Core Abstractions

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

## Views

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

## Debug Panel

The debug panel provides interactive debugging capabilities:
- View source code
- Step through execution
- Set breakpoints
- Inspect variables
- Control execution flow (continue, pause, step over, step into, step out)

## AI-Powered Analysis

Flow Insight includes an AI-powered analysis tool that:
- Generates comprehensive reports about your system
- Identifies potential issues and bottlenecks
- Provides optimization suggestions

## API Reference

### Data Models

#### Core Types

| Type | Fields | Description |
|------|--------|-------------|
| Service | `id: string`<br>`name: string`<br>`type: "service"`<br>`state?: string`<br>`pid?: number`<br>`nodeId?: string`<br>`gpuDevices?: Array<{index: number, name: string, uuid: string, memoryUsed: number, memoryTotal: number, utilization?: number}>`<br>`requiredResources?: Record<string, number>`<br>`placementGroup?: {id: string}`<br>`contextInfo?: Record<string, any>`<br>`processStats?: {cpuPercent: number, memoryInfo: {rss: number, vms?: number, shared?: number, text?: number, lib?: number, data?: number, dirty?: number}}`<br>`nodeCpuPercent?: number`<br>`nodeMem?: number[]`<br>`mem?: number[]`<br>`resourceUsage?: Record<string, {used: number, base: string}>` | Core service component with resource information |
| Method | `id: string`<br>`instanceId: string`<br>`name: string`<br>`serviceName?: string`<br>`type?: "method"` | RPC method belonging to a service |
| Function | `id: string`<br>`name: string`<br>`type?: "function"` | Stateless function component |

#### View Types

| Type | Fields | Description |
|------|--------|-------------|
| PhysicalViewData | `physicalView: Record<string, NodeData>`<br>where `NodeData` contains:<br>`resources: Record<string, {total: number, available: number}>`<br>`services: Record<string, Service>`<br>`gpus?: Array<{index: number, name: string, uuid: string, utilizationGpu: number, memoryUsed: number, memoryTotal: number, processesPids: Array<{pid: number, gpuMemoryUsage: number}>}>` | Physical deployment information |
| FlameGraphData | `nodes: Array<{id: string, nodeId: string, startTime: number, endTime: number, duration: number, callerService: string \| null, callerFunc: string, serviceName: string \| null, serviceState?: string, parentId?: string}>`<br>`aggregated: Array<{name: string[], value: number, count?: number, totalInParent?: Array<{callerNodeId: string[], duration: number, count: number, startTime: number}>, serviceName?: string}>`<br>`parentStartTimes: Array<{calleeId: string[], startTimes: Array<{callerId: string[], startTime: number}>}>` | Hierarchical call data |

### API Endpoints

#### Graph Operations

| Endpoint | Method | Parameters | Returns | Description |
|----------|--------|------------|---------|-------------|
| `/call_graph` | GET | `job_id?: string`<br>`stack_mode?: boolean` | `{ result: boolean, msg: string, data: { graphData: GraphData } }` | Get call graph data |

#### Physical View Operations

| Endpoint | Method | Parameters | Returns | Description |
|----------|--------|------------|---------|-------------|
| `/physical_view` | GET | `job_id: string` | `{ result: boolean, msg: string, data: PhysicalViewData }` | Get physical deployment data |

#### Flame Graph Operations

| Endpoint | Method | Parameters | Returns | Description |
|----------|--------|------------|---------|-------------|
| `/flame_graph` | GET | `job_id: string` | `{ result: boolean, msg: string, data: { flameData: FlameGraphData } }` | Get flame graph data |

#### Debug Operations

| Endpoint | Method | Parameters | Returns | Description |
|----------|--------|------------|---------|-------------|
| `/get_debug_sessions` | GET | `job_id: string`<br>`service_name?: string`<br>`func_name?: string`<br>`filter_active?: boolean` | `{ result: boolean, msg: string, data: { result: DebugSession[] } }` | Get debug sessions |
| `/get_active_debug_sessions` | GET | `job_id: string` | `{ result: boolean, msg: string, data: { result: string[] } }` | Get active debug sessions |
| `/get_breakpoints` | GET | `job_id: string`<br>`task_id: string` | `{ result: boolean, msg: string, data: { result: Breakpoint[] } }` | Get breakpoints |
| `/set_breakpoints` | GET | `job_id: string`<br>`task_id: string`<br>`breakpoints: string` | `{ result: boolean, msg: string }` | Set breakpoints |
| `/debug_cmd` | GET | `job_id: string`<br>`task_id: string`<br>`command: string`<br>`args: string` | `{ result: boolean, msg: string, data: { result: any } }` | Execute debug command |
| `/activate_debug_session` | GET | `job_id: string`<br>`service_name: string`<br>`func_name: string`<br>`task_id: string` | `{ result: boolean, msg: string }` | Activate debug session |
| `/deactivate_debug_session` | GET | `job_id: string`<br>`task_id: string` | `{ result: boolean, msg: string }` | Deactivate debug session |

#### Analysis Operations

| Endpoint | Method | Parameters | Returns | Description |
|----------|--------|------------|---------|-------------|
| `/get_insight_analyze_prompt` | GET | `job_id: string` | `{ result: boolean, msg: string, data: { prompt: string } }` | Get analysis prompt |


## Getting Started

### Prerequisites

- Node.js
- npm or yarn

### Installation

```bash
# Using npm
npm install flow-insight

# Using yarn
yarn add flow-insight
```

## Usage

### Importing the Component

```jsx
import { FlowInsight } from 'flow-insight';
```

### Basic Usage

```jsx
import React from 'react';
import { FlowInsight } from 'flow-insight';

const MyComponent = () => {
  return (
    <FlowInsight 
      baseUrl="https://your-api-endpoint.com"
      jobId="job-12345"
    />
  );
};

export default MyComponent;
```

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| baseUrl | string | Yes | - | API endpoint base URL |
| jobId | string | No | - | ID of the job to visualize |
| initialViewType | "logical" \| "physical" \| "flame" \| "call_stack" \| "analysis" | No | "logical" | Initial view to display |
| autoRefresh | boolean | No | false | Whether to automatically refresh data |
| refreshInterval | number | No | 2000 | Refresh interval in milliseconds |
| authToken | string | No | - | Authentication token for API requests |
| onElementClick | function | No | - | Callback when a graph element is clicked |
| showInfoCard | boolean | No | false | Whether to show the info card |
| selectedElementId | string | No | - | ID of the selected element |
| searchTerm | string | No | - | Search term for filtering elements |
| onAutoRefreshChange | function | No | - | Callback when auto-refresh setting changes |
| setViewType | function | Yes | - | Function to change the current view type |
| apiService | ApiService | Yes | - | Instance of the API service |

### Advanced Usage

```jsx
import React from 'react';
import { FlowInsight } from 'flow-insight';

const MyAdvancedComponent = () => {
  const handleElementClick = (data) => {
    console.log('Element clicked:', data);
  };

  const customColors = {
    service: '#4CAF50',
    method: '#2196F3',
    function: '#FFC107',
  };

  return (
    <FlowInsight 
      baseUrl="https://your-api-endpoint.com"
      jobId="job-12345"
      initialViewType="physical"
      autoRefresh={true}
      refreshInterval={5000}
      authToken="your-auth-token"
      onElementClick={handleElementClick}
      colorScheme={customColors}
    />
  );
};

export default MyAdvancedComponent;
```
