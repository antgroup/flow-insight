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

**Service**
- `id`: string - Unique identifier for the service
- `name`: string - Name of the service
- `type`: "service" - Type identifier
- `state?`: string - Optional service state
- `pid?`: number - Optional process ID
- `nodeId?`: string - Optional node identifier where service runs
- `gpuDevices?`: Array of GPU devices with:
  - `index`: number - Device index
  - `name`: string - Device name
  - `uuid`: string - Device UUID
  - `memoryUsed`: number - Used memory
  - `memoryTotal`: number - Total memory
  - `utilization?`: number - Optional utilization percentage
- `processStats?`: Process statistics including:
  - `cpuPercent`: number - CPU usage percentage
  - `memoryInfo`: Memory information with:
    - `rss`: number - Resident set size
    - Various optional memory metrics (vms, shared, text, lib, data, dirty)
- `requiredResources?`: Record mapping resource names to values
- `placementGroup?`: Optional placement group with ID
- `contextInfo?`: Optional context information
- `nodeCpuPercent?`: Optional node CPU percentage
- `nodeMem?` and `mem?`: Optional memory arrays
- `resourceUsage?`: Record mapping resource names to usage objects with:
  - `used`: number - Amount used
  - `base`: string - Base unit

**Method**
- `id`: string - Unique identifier for the method
- `instanceId`: string - Instance ID
- `name`: string - Method name
- `serviceName?`: string - Optional service name
- `type?`: "method" - Type identifier

**Function**
- `id`: string - Unique identifier for the function
- `name`: string - Function name
- `type?`: "function" - Type identifier

#### View Types

**PhysicalViewData**
- `physicalView`: Record mapping node names to NodeData objects

**NodeData**
- `resources`: Record mapping resource names to:
  - `total`: number - Total resource amount
  - `available`: number - Available resource amount
- `services`: Record mapping service IDs to Service objects
- `gpus?`: Optional array of GPU information with:
  - `index`: number - GPU index
  - `name`: string - GPU name
  - `uuid`: string - GPU UUID
  - `utilizationGpu`: number - GPU utilization
  - `memoryUsed`: number - Used memory
  - `memoryTotal`: number - Total memory
  - `processesPids`: Array of process information with:
    - `pid`: number - Process ID
    - `gpuMemoryUsage`: number - GPU memory used by process

**FlameGraphData**
- `nodes`: Array of flame graph nodes with:
  - `id`: string - Node ID
  - `nodeId`: string - Graph node ID
  - `startTime`: number - Start time
  - `endTime`: number - End time
  - `duration`: number - Duration
  - `callerService`: string or null - Caller service
  - `callerFunc`: string - Caller function
  - `serviceName`: string or null - Service name
  - `serviceState?`: string - Optional service state
  - `parentId?`: string - Optional parent ID
- `aggregated`: Array of aggregated data with:
  - `name`: string[] - Path of names
  - `value`: number - Value (typically duration)
  - `count?`: number - Optional count
  - `totalInParent?`: Optional array of parent data
  - `serviceName?`: Optional service name
- `parentStartTimes`: Array of parent timing information

**GraphData**
- `services`: Array of Service objects
- `methods`: Array of Method objects
- `functions`: Array of Function objects
- `callFlows`: Array of call flow information with:
  - `source`: string - Source ID
  - `target`: string - Target ID
  - `count`: number - Call count
  - `startTime`: number - Start time
- `dataFlows`: Array of data flow information with:
  - `source`: string - Source ID
  - `target`: string - Target ID
  - `speed`: string - Transfer speed
  - `timestamp`: number - Time of flow
  - `argpos?`: number - Optional argument position
  - `duration?`: number - Optional duration
  - `size?`: number - Optional data size

**Debug Types**
- **DebugSession**
  - `serviceName`: string - Service name
  - `funcName`: string - Function name
  - `taskId`: string - Task ID

- **Breakpoint**
  - `sourceFile`: string - Source file path
  - `line`: number - Line number

### API Endpoints

#### Response Format

All API endpoints return responses in this standard format:

**ApiResponse<T>**
- `result`: boolean - Success status
- `msg`: string - Status message
- `data`: T - Response data

#### Graph Operations

**GET /call_graph**
- Parameters:
  - `job_id?`: string - Optional job ID
  - `stack_mode?`: boolean - Whether to return stack mode data
- Returns: ApiResponse with graphData field containing GraphData
- Description: Get call graph data

#### Physical View Operations

**GET /physical_view**
- Parameters:
  - `job_id`: string - Job ID
- Returns: ApiResponse with PhysicalViewData
- Description: Get physical deployment data

#### Flame Graph Operations

**GET /flame_graph**
- Parameters:
  - `job_id`: string - Job ID
- Returns: ApiResponse with flameData field containing FlameGraphData
- Description: Get flame graph data

#### Debug Operations

**GET /get_debug_sessions**
- Parameters:
  - `job_id`: string - Job ID
  - `service_name?`: string - Optional service name
  - `func_name?`: string - Optional function name
  - `filter_active?`: boolean - Whether to filter active sessions
- Returns: ApiResponse with result field containing array of DebugSession objects
- Description: Get debug sessions

**GET /get_active_debug_sessions**
- Parameters:
  - `job_id`: string - Job ID
- Returns: ApiResponse with result field containing array of session IDs
- Description: Get active debug sessions

**GET /get_breakpoints**
- Parameters:
  - `job_id`: string - Job ID
  - `task_id`: string - Task ID
- Returns: ApiResponse with result field containing array of Breakpoint objects
- Description: Get breakpoints

**GET /set_breakpoints**
- Parameters:
  - `job_id`: string - Job ID
  - `task_id`: string - Task ID
  - `breakpoints`: string - Base64 encoded JSON of breakpoints
- Returns: ApiResponse with boolean result
- Description: Set breakpoints

**GET /debug_cmd**
- Parameters:
  - `job_id`: string - Job ID
  - `task_id`: string - Task ID
  - `command`: string - Debug command to execute
  - `args`: string - Base64 encoded JSON of command arguments
- Returns: ApiResponse with result field containing command result
- Description: Execute debug command

**GET /activate_debug_session**
- Parameters:
  - `job_id`: string - Job ID
  - `service_name`: string - Service name
  - `func_name`: string - Function name
  - `task_id`: string - Task ID
- Returns: ApiResponse with boolean result
- Description: Activate debug session

**GET /deactivate_debug_session**
- Parameters:
  - `job_id`: string - Job ID
  - `task_id`: string - Task ID
- Returns: ApiResponse with boolean result
- Description: Deactivate debug session

#### Analysis Operations

**GET /get_insight_analyze_prompt**
- Parameters:
  - `job_id`: string - Job ID
- Returns: ApiResponse with prompt field containing analysis prompt
- Description: Get analysis prompt

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

### Props

**FlowInsight Component Props**

- **Required Props**
  - `baseUrl`: string - API endpoint base URL

- **Optional Props**
  - `jobId`: string - ID of the job to visualize
  - `initialViewType`: string - Initial view to display, one of:
    - "logical" (default)
    - "call_stack"
    - "physical"
    - "flame"
    - "analysis"
  - `autoRefresh`: boolean - Whether to automatically refresh data (default: false)
  - `refreshInterval`: number - Refresh interval in milliseconds (default: 2000)
  - `authToken`: string - Authentication token for API requests
  - `onElementClick`: function - Callback when a graph element is clicked
  - `colorScheme`: object - Custom color mapping for graph elements

### Basic Usage

To use the FlowInsight component in your React application:

1. **Import the FlowInsight component**:
   ```jsx
   import { FlowInsight } from 'flow-insight';
   ```

2. **Basic component usage**:
   ```jsx
   <FlowInsight 
     baseUrl="https://your-api-endpoint.com"
     jobId="job-12345"
   />
   ```

3. **With additional options**:
   ```jsx
   <FlowInsight 
     baseUrl="https://your-api-endpoint.com"
     jobId="job-12345"
     initialViewType="physical"
     autoRefresh={true}
     refreshInterval={5000}
   />
   ```

### Advanced Usage

**React component with full options**

```jsx
import React, { useCallback } from 'react';
import { FlowInsight } from 'flow-insight';

function MyMonitoringComponent() {
  // Handle element click event
  const handleElementClick = useCallback((data) => {
    console.log('Element clicked:', data);
    // Access properties like data.id, data.name, etc.
  }, []);

  // Custom color scheme
  const customColors = {
    service: '#4CAF50',
    method: '#2196F3',
    function: '#FFC107',
  };

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <FlowInsight 
        baseUrl="https://your-api-endpoint.com"
        jobId="job-12345"
        initialViewType="logical"
        autoRefresh={true}
        refreshInterval={5000}
        authToken="your-auth-token"
        onElementClick={handleElementClick}
        colorScheme={customColors}
      />
    </div>
  );
}

export default MyMonitoringComponent;
```

**Setting up in a data dashboard**

```jsx
import React, { useState, useEffect } from 'react';
import { FlowInsight } from 'flow-insight';

function SystemDashboard() {
  const [jobId, setJobId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Fetch active jobs and select the first one
  useEffect(() => {
    async function fetchJobs() {
      try {
        const response = await fetch('https://your-api-endpoint.com/jobs');
        const jobs = await response.json();
        if (jobs.length > 0) {
          setJobId(jobs[0].id);
        }
      } catch (error) {
        console.error('Failed to fetch jobs:', error);
      }
    }
    
    fetchJobs();
  }, []);
  
  return (
    <div>
      <div className="controls">
        <select onChange={(e) => setJobId(e.target.value)}>
          {/* Job selection options */}
        </select>
        <label>
          <input 
            type="checkbox" 
            checked={autoRefresh} 
            onChange={(e) => setAutoRefresh(e.target.checked)} 
          />
          Auto-refresh
        </label>
      </div>
      
      {jobId && (
        <div style={{ height: "calc(100vh - 60px)" }}>
          <FlowInsight 
            baseUrl="https://your-api-endpoint.com"
            jobId={jobId}
            autoRefresh={autoRefresh}
          />
        </div>
      )}
    </div>
  );
}

export default SystemDashboard;
```
