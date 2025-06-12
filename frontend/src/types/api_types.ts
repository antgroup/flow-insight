// Service type
export type ATService = {
  serviceName: string;
  instanceId: string;
};

// Method type
export type ATMethod = {
  id: string;
  method: {
    name: string;
  };
  service: ATService;
};

// Function type
export type ATFunction = {
  id: string;
  method: {
    name: string;
  };
  service: ATService | null;
};

// Call Flow type
export type ATCallFlow = {
  sourceId: string;
  targetId: string;
  count: number;
  startTime: number;
};

// Data Flow type
export type ATDataFlow = {
  sourceId: string;
  targetId: string;
  argpos: number;
  duration: number;
  size: number;
  timestamp: number;
};

// Graph Data type
export type ATGraphData = {
  services: ATService[];
  methods: ATMethod[];
  functions: ATFunction[];
  callFlows: ATCallFlow[];
  dataFlows: ATDataFlow[];
};

// FlameTreeNode type matching backend structure (will be converted to camelCase)
export type ATFlameTreeNode = {
  spanId: string;
  id: string;
  startTime: number;
  endTime: number;
  children: ATFlameTreeNode[];
};

// Flame Graph Data type - using tree structure
export type ATFlameGraphData = {
  root: ATFlameTreeNode;
};

// Service stats type
export type ATServiceStats = {
  nodeId: string;
  pid: number;
  state: string;
  requiredResources: Record<string, any>;
  placementId: string | null;
  cpuPercent: number;
  memoryInfo: {
    rss: number;
    vms: number;
    shared: number;
    text: number;
    lib: number;
    data: number;
    dirty: number;
  };
  devices: Record<string, any>;
};

// Service with stats type
export type ATServiceWithStats = {
  service: ATService;
  stats: ATServiceStats;
};

// Node resources type
export type ATNodeResources = {
  total: number;
  available: number;
};

// Node type
export type ATNode = {
  nodeId: string;
  devices: {
    gpu: any[];
  };
  resources: Record<string, ATNodeResources>;
  cpuPercent: number;
  memoryInfo: {
    total: number;
    used: number;
    available: number;
  };
};

// Physical View Data type
export type ATPhysicalViewData = {
  services: ATServiceWithStats[];
  nodes: Record<string, ATNode>;
};

export type ATDebugSession = {
  service: ATService;
  method: {
    name: string;
  };
  spanId: string;
};

export type ATContext = {
  service: ATService;
  method: {
    name: string;
  };
  context: Record<string, any>;
};

export type ATResourceUsage = {
  service: ATService;
  method: {
    name: string;
  };
  usage: Record<
    string,
    {
      used: number;
      base: string;
    }
  >;
};
