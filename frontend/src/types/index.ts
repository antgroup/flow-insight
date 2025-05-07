// Basic Node Types
export type Service = {
  id: string;
  instanceId: string;
  name: string;
  type: 'service';
  gpuDevices?: Array<{
    index: number;
    name: string;
    uuid: string;
    memoryUsed: number;
    memoryTotal: number;
    utilization?: number;
  }>;
  state?: string;
  pid?: number;
  nodeId?: string;
  requiredResources?: Record<string, number>;
  placementGroup?: {
    id: string;
  };
  contextInfo?: Record<string, any>;
  processStats?: {
    cpuPercent: number;
    memoryInfo: {
      rss: number;
      vms?: number;
      shared?: number;
      text?: number;
      lib?: number;
      data?: number;
      dirty?: number;
    };
  };
  nodeCpuPercent?: number;
  nodeMem?: number[];
  resourceUsage?: Record<
    string,
    {
      used: number;
      base: string;
    }
  >;
};

export type Method = {
  id: string;
  instanceId: string;
  name: string;
  serviceName?: string;
  type?: 'method';
};

export type FunctionNode = {
  id: string;
  name: string;
  type?: 'function';
};

export type ElementData = Service | Method | FunctionNode;

// Graph Data Types
export type GraphData = {
  services: Service[];
  methods: Method[];
  functions: FunctionNode[];
  callFlows: {
    source: string;
    target: string;
    count: number;
    startTime: number;
  }[];
  dataFlows: {
    source: string;
    target: string;
    timestamp: number;
    argpos?: number;
    duration?: number;
    size?: number;
  }[];
};

// Debug Types
export type DebugSession = {
  serviceInfo: string[];
  funcName: string;
  spanId: string;
  sourceDir: string;
  trimLevel: number;
};

export type Breakpoint = {
  sourceFile: string;
  line: number;
};

// Physical View Types
export type ResourceValue = {
  total: number;
  available: number;
};

// Resource usage info type for functions returning usage information
export type ResourceUsageInfo = {
  available: number;
  total: number;
  used: number;
  usage: number;
};

export type NodeData = {
  resources: Record<string, ResourceValue>;
  services: Record<string, Service>;
  gpus?: Array<{
    index: number;
    name: string;
    uuid: string;
    memoryUsed: number;
    memoryTotal: number;
    utilization?: number;
  }>;
};

export type PhysicalViewData = {
  physicalView: Record<string, NodeData>;
};

export type FlameGraphNode = {
  name: string;
  value: number;
  count?: number;
  totalInParent?: Array<{
    callerNodeId: string;
    duration: number;
    count: number;
    startTime: number;
  }>;
  serviceName?: string;
};

export type FlameGraphData = {
  aggregated: FlameGraphNode[];
  parentStartTimes: Array<{
    calleeId: string;
    startTimes: Array<{
      callerId: string;
      startTime: number;
    }>;
  }>;
};
