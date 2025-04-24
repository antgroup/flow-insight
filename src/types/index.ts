// Basic Node Types
export type Actor = {
  id: string;
  actorId: string;
  name: string;
  language: string;
  type: "actor";
  devices: string[];
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
  mem?: number[];
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
  actorId?: string;
  name: string;
  language: string;
  actorName?: string;
  type?: "method";
};

export type FunctionNode = {
  id: string;
  name: string;
  language: string;
  actorId?: string;
  type?: "function";
};

export type ElementData = Actor | Method | FunctionNode;

// Graph Data Types
export type GraphData = {
  actors: Actor[];
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
    speed: string;
    timestamp: number;
    argpos?: number;
    duration?: number;
    size?: number;
  }[];
};

// Debug Types
export type DebugSession = {
  className: string;
  funcName: string;
  taskId: string;
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
  actors: Record<string, Actor>;
  gpus?: Array<{
    index: number;
    name: string;
    uuid: string;
    utilizationGpu: number;
    memoryUsed: number;
    memoryTotal: number;
    processesPids: Array<{
      pid: number;
      gpuMemoryUsage: number;
    }>;
  }>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  class?: string;
  originalData?: any;
  actorName?: string;
  actorId?: string;
};

export type PhysicalViewData = {
  physicalView: Record<string, NodeData>;
  nodes: Record<string, NodeData>;
  placementGroups: Record<string, string[]>;
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
  actorName?: string;
};

export type FlameGraphData = {
  nodes: Array<{
    id: string;
    nodeId: string;
    startTime: number;
    endTime: number;
    duration: number;
    callerClass: string | null;
    callerFunc: string;
    actorName: string | null;
    actorState?: string;
    parentId?: string;
  }>;
  aggregated: FlameGraphNode[];
  parentStartTimes: Array<{
    calleeId: string;
    startTimes: Array<{
      callerId: string;
      startTime: number;
    }>;
  }>;
};
