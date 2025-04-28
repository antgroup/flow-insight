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
- [Views](#-views)
- [Documentation](#-documentation)
- [Contributing](#-contributing)

## 📥 Installation

### Prerequisites

- Node.js (v14 or later)
- npm or yarn

### Installation Steps

```bash
# Using npm
npm install flow-insight

# Using yarn
yarn add flow-insight
```

## 🔧 Usage

### Importing the Component

```jsx
import { FlowInsight } from 'flow-insight';
```

### Basic Usage

```jsx
<FlowInsight 
  baseUrl="https://your-api-endpoint.com"
  FlowId="job-12345"
/>
```

### With Additional Options

```jsx
<FlowInsight 
  baseUrl="https://your-api-endpoint.com"
  FlowId="job-12345"
  initialViewType="physical"
  autoRefresh={true}
  refreshInterval={5000}
/>
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

## 📚 Documentation

For comprehensive documentation, visit our [documentation site](https://antgroup.github.io/flowinsight).

## 👥 Contributing

We welcome contributions from the community! Please check out our [Contributing Guidelines](CONTRIBUTING.md) for more information on how to get started.

## 🙏 Acknowledgements

Thanks to all contributors who have helped make Flow Insight better!
