# Flow Insight

[![Python](https://img.shields.io/badge/python-3.7+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Flow Insight** is a observability platform for distributed Python applications, providing interactive debugging, and beautiful visualizations for complex distributed systems.

> **🎯 Note**: Flow Insight is **integrated into [Ant-Ray](https://github.com/antgroup/ant-ray)** - Ant Group's enhanced distribution of Ray, providing native observability for Ray applications.

## 🎯 Core Features

### Visualizations
- **📊 Logical View** - Service relationships and call graphs
- **🔥 Flame Graph** - Performance analysis with hierarchical breakdowns
- **📈 Gantt Chart** - Interactive timeline with expand/collapse
- **🌐 Distributed Stack** - Cross-service execution tracing
- **🎛️ Debug Panel** - Live debugging with breakpoints

### Abstractions
- **Services** - Stateful components with lifecycle tracking
- **Methods** - RPC functions with input/output capture
- **Functions** - Stateless operations with resource monitoring
- **Objects** - Data flow tracking across service boundaries

## 🚀 Quick Start

### Prerequisites
```bash
# Node.js 18+ and Python 3.10+
npm --version && python --version
```

### Installation
```bash
# Clone and setup
git clone https://github.com/antgroup/flow-insight.git
cd flow-insight

# Build frontend
cd sdk/flow_insight/frontend
npm install && npm run build

# Install SDK
cd ../../
pip install -e .
```

### Usage
```bash
# start flow insight server
flowinsight run

# run demo
python demo/local_visualize.py
```

Open **http://localhost:8080** for live visualization.


## 📄 License

Apache 2.0 License - see [LICENSE](LICENSE) file for details.
