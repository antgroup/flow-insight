// API Service for Flow Insight
import { Service, GraphData, PhysicalViewData, FlameGraphData, DebugSession, Breakpoint } from '../types';
import { encodingForModel, TiktokenModel } from "js-tiktoken";
import axios, { AxiosRequestConfig } from "axios";
import { ATGraphData, ATPhysicalViewData, ATFlameGraphData, ATService, ATMethod, ATFunction, ATCallFlow, ATDataFlow, ATServiceWithStats, ATServiceStats, ATNode, ATDebugSession, ATContext, ATResourceUsage } from '../types/api_types';

export type ApiConfig = {
  baseUrl: string;
  authToken?: string;
};

export type ApiResponse<T> = {
  result: boolean;
  msg: string;
  data: T;
};

// Cache entry type
type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

// Export types needed by DebugPanel
export class ApiService {
  private apiConfig: ApiConfig;
  private baseUrl: string;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private cacheTime: number = 2000; // 2 seconds in milliseconds
  private maxCacheSize: number = 100; // Maximum number of cached items
  private maxTTL: number = 60000; // Maximum time to live: 1 minute (60000 ms)
  private inFlightRequests: Map<string, Promise<any>> = new Map();

  constructor(config: ApiConfig) {
    this.apiConfig = config;
    this.baseUrl = this.formatUrl(config.baseUrl);
    
    // Set up cache cleanup interval
    setInterval(() => this.cleanupCache(), 30000); // Clean cache every 30 seconds
  }
  
  // Clean up expired cache entries and enforce max size
  private cleanupCache(): void {
    const now = Date.now();
    
    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.maxTTL) {
        this.cache.delete(key);
      }
    }
    
    // If still over max size, remove oldest entries
    if (this.cache.size > this.maxCacheSize) {
      const entriesToDelete = this.cache.size - this.maxCacheSize;
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      for (let i = 0; i < entriesToDelete; i++) {
        this.cache.delete(entries[i][0]);
      }
    }
  }
  
  private formatUrl(url: string): string {
    if (url.startsWith("/")) {
      return url.slice(1);
    }
    return url;
  }

  public async request<T>(endpoint: string, options: AxiosRequestConfig = {}, data: any = null): Promise<T> {
    const url = this.formatUrl(`${this.baseUrl}/${endpoint}`);
    const method = options.method || 'GET';
    
    // Only cache GET requests
    if (method === 'GET') {
      const cacheKey = `${url}-${JSON.stringify(options)}-${JSON.stringify(data)}`;
      const cachedData = this.cache.get(cacheKey);
      const now = Date.now();
      
      // Return cached data if it exists and is not expired
      if (cachedData && (now - cachedData.timestamp) < this.cacheTime) {
        return cachedData.data;
      }

      // Check if there's already an in-flight request for this cache key
      if (this.inFlightRequests.has(cacheKey)) {
        // Return the promise of the in-flight request
        return this.inFlightRequests.get(cacheKey)!;
      }
      
      // Create the request promise
      const requestPromise = this.makeRequest<T>(url, options, data).then(result => {
        // Store the result in cache
        this.cache.set(cacheKey, {
          data: result,
          timestamp: now
        });
        
        // Check if cache size exceeds max and remove oldest if needed
        if (this.cache.size > this.maxCacheSize) {
          const oldestKey = Array.from(this.cache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
          this.cache.delete(oldestKey);
        }
        
        // Remove from in-flight requests
        this.inFlightRequests.delete(cacheKey);
        
        return result;
      }).catch(error => {
        // Remove from in-flight requests on error
        this.inFlightRequests.delete(cacheKey);
        throw error;
      });
      
      // Store the request promise in the in-flight requests map
      this.inFlightRequests.set(cacheKey, requestPromise);
      
      return requestPromise;
    }
    
    // For non-GET requests, skip caching
    return this.makeRequest<T>(url, options, data);
  }
  
  private async makeRequest<T>(url: string, options: AxiosRequestConfig, data: any): Promise<T> {
    const config: AxiosRequestConfig = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };
    
    if (this.apiConfig.authToken) {
      config.headers = {
        ...config.headers,
        'Authorization': `Bearer ${this.apiConfig.authToken}`
      };
    }
    if (data){
      config.data = data;
    }
    
    try {
      const response = await axios.request<T>({
        ...config,
        url,
        method: options.method || 'GET'
      });
      
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(`API request failed: ${error.response.statusText}`);
      }
      throw error;
    }
  }
   // Helper function to convert snake_case keys to camelCase
  private convertKeysToCamelCase(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.convertKeysToCamelCase(item));
    }

    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      acc[camelKey] = this.convertKeysToCamelCase(obj[key]);
      return acc;
    }, {} as any);
  }
  
  // Graph Data
  public async getApiGraphData(flowId: string, stackMode = false): Promise<ATGraphData> {
    const path = `get_call_graph_data?flow_id=${flowId}&stack_mode=${stackMode}`;
    const response = await this.request<ApiResponse<any>>(path);
    
    if (!response.result) {
      throw new Error(response.msg || 'Failed to get graph data');
    }
    
    // Convert snake_case to camelCase
    const graphData = this.convertKeysToCamelCase(response.data);
    
    return graphData as ATGraphData;
  }

  private ATStatsToService(contextData: ATContext, resourceUsage: ATResourceUsage, nodeStats: ATNode, serviceStats: ATServiceStats, instance_id: string, servce_name: string): Service {
    return {
      id: instance_id,
      instanceId: instance_id,
      name: servce_name,
      type: "service",
      gpuDevices: serviceStats.devices.gpu?.map((gpu: any) => ({
          index: gpu.index,
          name: gpu.name,
          uuid: gpu.uuid,
          memoryUsed: gpu.memoryUsed,
          memoryTotal: gpu.memoryTotal,
          utilization: gpu.utilization,
        })),
      state: serviceStats.state,
      pid: serviceStats.pid,
      nodeId: serviceStats.nodeId || "",
      requiredResources: serviceStats.requiredResources,
      nodeCpuPercent: nodeStats.cpuPercent,
      nodeMem: [nodeStats.memoryInfo.total, nodeStats.memoryInfo.available, 0, nodeStats.memoryInfo.available],
      placementGroup: {
        id: serviceStats.placementId || "",
      },
      processStats: {
        cpuPercent: serviceStats.cpuPercent,
        memoryInfo: serviceStats.memoryInfo,
      },
      contextInfo: contextData? contextData.context : {},
      resourceUsage: resourceUsage? resourceUsage.usage : {},
    }
  }
  public async getGraphData(flowId: string, stackMode = false): Promise<GraphData> {
    const apiGraphData = await this.getApiGraphData(flowId, stackMode);
    const apiPhysicalViewData = await this.getApiPhysicalViewData(flowId);
    const nodeStats: Record<string, ATNode> = apiPhysicalViewData.nodes;
    const serviceStats: ATServiceWithStats[] = apiPhysicalViewData.services;
    const serviceStatsMap: Record<string, ATServiceStats> = serviceStats.reduce((acc, service) => {
      acc[service.service.instanceId] = service.stats;
      return acc;
    }, {} as Record<string, ATServiceStats>);
    const apiContextData = await this.getContextData(flowId);
    const apiResourceUsage = await this.getResourceUsage(flowId);
    const contextDataMap: Record<string, ATContext> = apiContextData.reduce((acc, context) => {
      acc[context.service.instanceId] = context;
      return acc;
    }, {} as Record<string, ATContext>);
    const resourceUsageMap: Record<string, ATResourceUsage> = apiResourceUsage.reduce((acc, resource) => {
      acc[resource.service.instanceId] = resource;
      return acc;
    }, {} as Record<string, ATResourceUsage>);
    const graphData: GraphData = {
      services: apiGraphData.services.map((service: ATService) => this.ATStatsToService(contextDataMap[service.instanceId], resourceUsageMap[service.instanceId],serviceStatsMap[service.instanceId]?nodeStats[serviceStatsMap[service.instanceId].nodeId]: 
        {
          nodeId: "",
          devices: {
            gpu: [],
          },
          resources: {},
          cpuPercent: 0,
          memoryInfo: {
            total: 0,
            available: 0,
            used: 0,
          },
        }, serviceStatsMap[service.instanceId]?serviceStatsMap[service.instanceId]: 
        {
          nodeId: "",
          devices: {
            gpu: [],
          },
          cpuPercent: 0,
          memoryInfo: {
            rss: 0,
            vms: 0,
            shared: 0,
            text: 0,
            lib: 0,
            data: 0,
            dirty: 0,
          },
          pid: 0,
          state: "unknown",
          requiredResources: {},
          placementId: "",
        }, service.instanceId, service.serviceName)),
      methods: apiGraphData.methods.map((method: ATMethod) => ({
        id: method.id,
        instanceId: method.service.instanceId,
        serviceName: method.service.serviceName,
        name: method.method.name,
        type: "method",
      })),
      functions: apiGraphData.functions.map((func: ATFunction) => ({
        id: func.id,
        name: func.method.name,
        type: "function",
      })),
      callFlows: apiGraphData.callFlows.map((callFlow: ATCallFlow) => ({
        source: callFlow.sourceId,
        target: callFlow.targetId,
        count: callFlow.count,
        startTime: callFlow.startTime / 1000,
      })),
      dataFlows: apiGraphData.dataFlows.map((dataFlow: ATDataFlow) => ({
        source: dataFlow.sourceId,
        target: dataFlow.targetId,
        timestamp: dataFlow.timestamp / 1000,
        argpos: dataFlow.argpos,
        duration: dataFlow.duration / 1000,
        size: dataFlow.size,
      })),
    }
    return graphData;
  }

  // Context Data
  public async getContextData(flowId: string): Promise<ATContext[]> {
    const path = `get_context?flow_id=${flowId}`;
    const response = await this.request<ApiResponse<ATContext[]>>(path);
    return this.convertKeysToCamelCase(response.data);
  }

  // Resource Usage
  public async getResourceUsage(flowId: string): Promise<ATResourceUsage[]> {
    const path = `get_resource_usage?flow_id=${flowId}`;
    const response = await this.request<ApiResponse<ATResourceUsage[]>>(path);
    return this.convertKeysToCamelCase(response.data);
  }
  
  // Physical View Data
  public async getApiPhysicalViewData(flowId: string): Promise<ATPhysicalViewData> {
    const path = `get_physical_view_data?flow_id=${flowId}`;
    const response = await this.request<ApiResponse<any>>(path);
    
    if (!response.result) {
      throw new Error(response.msg || 'Failed to get physical view data');
    }
    
    // Convert snake_case to camelCase
    const physicalViewData = this.convertKeysToCamelCase(response.data);
    
    return physicalViewData as ATPhysicalViewData;
  }

  public async getPhysicalViewData(flowId: string): Promise<PhysicalViewData> {
    const apiPhysicalViewData = await this.getApiPhysicalViewData(flowId);
    const nodeStats: Record<string, ATNode> = apiPhysicalViewData.nodes;
    const serviceStats: ATServiceWithStats[] = apiPhysicalViewData.services;
    const serviceStatsMap: Record<string, ATServiceStats> = serviceStats.reduce((acc, service) => {
      acc[service.service.instanceId] = service.stats;
      return acc;
    }, {} as Record<string, ATServiceStats>);
    const serviceIdToName: Record<string, string> = serviceStats.reduce((acc, service) => {
      acc[service.service.instanceId] = service.service.serviceName;
      return acc;
    }, {} as Record<string, string>);
    const apiContextData = await this.getContextData(flowId);
    const apiResourceUsage = await this.getResourceUsage(flowId);
    const contextDataMap: Record<string, ATContext> = apiContextData.reduce((acc, context) => {
      acc[context.service.instanceId] = context;
      return acc;
    }, {} as Record<string, ATContext>);
    const resourceUsageMap: Record<string, ATResourceUsage> = apiResourceUsage.reduce((acc, resource) => {
      acc[resource.service.instanceId] = resource;
      return acc;
    }, {} as Record<string, ATResourceUsage>);
    const physicalViewData: PhysicalViewData = {
      physicalView: Object.fromEntries(
        Object.entries(nodeStats).map(([nodeId, nodeData]) => [
          nodeId,
          {
            resources: nodeData.resources,
            services: Object.fromEntries(
              Object.entries(serviceStatsMap).filter(([instanceId, serviceData]) => serviceData.nodeId === nodeId).map(([instanceId, serviceData]) => [
                instanceId,
                this.ATStatsToService(contextDataMap[instanceId], resourceUsageMap[instanceId], nodeData, serviceData, instanceId, serviceIdToName[instanceId]),
              ]),
            ),
            gpus: nodeData.devices.gpu,
          },
        ]),
      ),
    };
    return physicalViewData;
  }
  
  // Flame Graph Data
  public async getApiFlameGraphData(flowId: string): Promise<ATFlameGraphData> {
    const path = `get_flame_graph_data?flow_id=${flowId}`;
    const response = await this.request<ApiResponse<any>>(path);
    
    if (!response.result) {
      throw new Error(response.msg || 'Failed to get flame graph data');
    }
    
    // Convert snake_case to camelCase
    const flameData = this.convertKeysToCamelCase(response.data);
    
    return flameData as ATFlameGraphData;
  }

  public async getFlameGraphData(flowId: string): Promise<FlameGraphData> {
    const apiFlameGraphData = await this.getApiFlameGraphData(flowId);
    const flameData: FlameGraphData = {
      aggregated: apiFlameGraphData.aggregated,
      parentStartTimes: apiFlameGraphData.parentStartTimes.map((parentStartTime: any) => ({
        calleeId: parentStartTime.calleeId,
        startTimes: parentStartTime.startTimes.map((startTime: any) => ({
          callerId: startTime.callerId,
          startTime: startTime.startTime / 1000,
        })),
      })),
    };
    return flameData;
  }

  // Debug Sessions
  public async getDebugSessions(
    flowId: string,
    serviceInfo?: string[] | null,
    funcName?: string | null,
    filterActive = false
  ): Promise<DebugSession[]> {
    let path = `get_debug_sessions?flow_id=${flowId}&filter_active=${filterActive}`;
    
    if (serviceInfo !== null && serviceInfo && serviceInfo.length > 0) {
      path += `&service_name=${serviceInfo[0]}&instance_id=${serviceInfo[1]}`;
    }
    
    if (funcName !== null) {
      path += `&method_name=${funcName}`;
    }
    
    const response = await this.request<ApiResponse<ATDebugSession[]>>(path);
    return this.convertKeysToCamelCase(response.data).map((session: ATDebugSession) => ({
      serviceInfo: session.service? [session.service.serviceName, session.service.instanceId] : [],
      funcName: session.method.name,
      spanId: session.spanId,
    }));
  }
  
  // Active Debug Sessions
  public async getActiveDebugSessions(flowId: string): Promise<string[]> {
    const path = `get_active_debug_sessions?flow_id=${flowId}`;
    const response = await this.request<ApiResponse<string[]>>(path);
    return response.data;
  }
  
  // Breakpoints
  public async getBreakpoints(flowId: string, spanId: string): Promise<Breakpoint[]> {
    const path = `get_breakpoints?flow_id=${flowId}&span_id=${spanId}`;
    const response = await this.request<ApiResponse<Breakpoint[]>>(path);
    return this.convertKeysToCamelCase(response.data);
  }
  
  // Set Breakpoints
  public async setBreakpoints(
    flowId: string,
    spanId: string,
    breakpoints: Breakpoint[]
  ): Promise<boolean> {
    const path = `set_breakpoints`;
    const response = await this.request<ApiResponse<boolean>>(path, {
      method: 'POST',
    }, {
      flow_id: flowId,
      span_id: spanId,
      breakpoints: breakpoints,
    });
    return response.result;
  }
  
  // Debug Commands
  public async sendDebugCommand(
    flowId: string,
    spanId: string,
    command: string,
    args: Record<string, any>
  ): Promise<any> {
    const path = `debug_cmd`;
    const response = await this.request<ApiResponse<any>>(path, {
      method: 'POST',
    }, {
      flow_id: flowId,
      span_id: spanId,
      command: command,
      args: args,
    });
    return {
      result: this.convertKeysToCamelCase(response.data),
    };
  }
  
  // Activate Debug Session
  public async activateDebugSession(
    flowId: string, 
    serviceInfo: string[], 
    funcName: string,
    spanId: string
  ): Promise<boolean> {
    const path = `activate_debug_session`;
    let data = {
      flow_id: flowId,
      span_id: spanId,
      method_name: funcName,
    };
    if (serviceInfo && serviceInfo.length > 0){
      const new_data = {
        service_name: serviceInfo[0],
        instance_id: serviceInfo[1],
      };
      data = {
        ...data,
        ...new_data,
      };
    }
    const response = await this.request<ApiResponse<boolean>>(path, {
      method: 'POST',
    }, data);
    return response.result;
  }
  
  // Deactivate Debug Session
  public async deactivateDebugSession(
    flowId: string,
    spanId: string
  ): Promise<boolean> {
    const path = `deactivate_debug_session`;
    const response = await this.request<ApiResponse<boolean>>(path, {
      method: 'POST',
    }, {
      flow_id: flowId,
      span_id: spanId,
    });
    return response.result;
  }
  
  // Insight Analysis
  public async getInsightAnalyzePrompt(): Promise<string> {
    const path = `get_prompt`;
    const response = await this.request<ApiResponse<string>>(path);
    return response.data;
  }
  
  // Store Breakpoints
  public async storeBreakpoints(
    flowId: string,
    spanId: string,
    breakpoints: Breakpoint[]
  ): Promise<boolean> {
    return this.setBreakpoints(flowId, spanId, breakpoints);
  }

  // Count Tokens
  public countTokens(text: string, model = "gpt-4"): number {
    try {
      // Get the encoding for the model
      const enc = encodingForModel(model.split("/")[1] as TiktokenModel);

      // Encode and count tokens
      const tokens = enc.encode(text);
      const count = tokens.length;

      return count;
    } catch (error) {
      // Fallback: estimate tokens as ~4 characters per token
      return Math.ceil(text.length / 4);
    }
  }

  // Generate Report with OpenAI API
  public async generateReport(
    prompt: string,
    apiKey: string,
    baseUrl: string,
    model: string,
    maxTokens?: number,
    stream?: boolean,
    onChunk?: (chunk: string) => void,
  ): Promise<any> {
    try {
      const requestBody: any = {
        model: model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.7,
      };

      // Add max_tokens if provided
      if (maxTokens) {
        requestBody.max_tokens = Math.min(maxTokens, 4096);
      }

      // Add streaming if requested
      if (stream) {
        requestBody.stream = true;
      }

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      // Handle streaming response
      if (stream && onChunk) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }

        let content = "";
        const decoder = new TextDecoder();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim() !== "");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.substring(6);
              if (data === "[DONE]") {
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const contentDelta = parsed.choices[0]?.delta?.content;
                if (contentDelta) {
                  content += contentDelta;
                  onChunk(contentDelta);
                }
              } catch (e) {
                console.error("Error parsing SSE data:", e);
              }
            }
          }
        }

        return content;
      }

      // Handle non-streaming response
      const data = await response.json();
      try {
        const content = data.choices[0].message.content;
        return content;
      } catch (error) {
        console.error("Failed to parse JSON response:", error);
        return {
          error: "Failed to parse response",
          raw: data.choices[0].message.content,
        };
      }
    } catch (error) {
      console.error("Error calling OpenAI API:", error);
      throw error;
    }
  }

  // Convert timestamps to readable format
  public formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  // Convert any timestamps in an object to readable format
  public convertTimestampsInObject(obj: any): any {
    if (!obj) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.convertTimestampsInObject(item));
    } else if (typeof obj === "object") {
      const result: any = {};
      for (const key in obj) {
        if (
          (key === "timestamp" || key === "startTime") &&
          typeof obj[key] === "number"
        ) {
          result[key] = this.formatTimestamp(obj[key]);
        } else {
          result[key] = this.convertTimestampsInObject(obj[key]);
        }
      }
      return result;
    }

    return obj;
  }

  // Replace IDs with names in graph data
  public replaceIdsWithNames(graphData: any): any {
    if (!graphData) {
      return graphData;
    }

    const result = { ...graphData };

    // Create a mapping of IDs to names
    const idToNameMap: Record<string, string> = {};

    // First pass: collect all service, method, and function IDs and their names
    if (result.services) {
      result.services.forEach((service: any) => {
        if (service.id && service.name) {
          idToNameMap[service.id] = service.name;
        }
      });
    }

    if (result.methods) {
      result.methods.forEach((method: any) => {
        if (method.id && method.name) {
          idToNameMap[method.id] = method.name;
        }
      });
    }

    if (result.functions) {
      result.functions.forEach((func: any) => {
        if (func.id && func.name) {
          idToNameMap[func.id] = func.name;
        }
      });
    }

    // Second pass: replace IDs with names in callFlows and dataFlows
    if (result.callFlows) {
      result.callFlows = result.callFlows.map((flow: any) => {
        const updatedFlow = { ...flow };

        // Add source name if available
        if (flow.source && idToNameMap[flow.source]) {
          updatedFlow.source = idToNameMap[flow.source];
        }

        // Add target name if available
        if (flow.target && idToNameMap[flow.target]) {
          updatedFlow.target = idToNameMap[flow.target];
        }

        return updatedFlow;
      });
    }

    if (result.dataFlows) {
      result.dataFlows = result.dataFlows.map((flow: any) => {
        const updatedFlow = { ...flow };

        // Add source name if available
        if (flow.source && idToNameMap[flow.source]) {
          updatedFlow.source = idToNameMap[flow.source];
        }

        // Add target name if available
        if (flow.target && idToNameMap[flow.target]) {
          updatedFlow.target = idToNameMap[flow.target];
        }

        return updatedFlow;
      });
    }

    return result;
  }
} 