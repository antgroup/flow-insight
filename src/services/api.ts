// API Service for Flow Insight
import { GraphData, PhysicalViewData, FlameGraphData, DebugSession, Breakpoint } from '../types';
import { encodingForModel, TiktokenModel } from "js-tiktoken";
import axios, { AxiosRequestConfig } from "axios";

export type ApiConfig = {
  baseUrl: string;
  authToken?: string;
};

export type ApiResponse<T> = {
  result: boolean;
  msg: string;
  data: T;
};

// Export types needed by DebugPanel
export class ApiService {
  private apiConfig: ApiConfig;
  private baseUrl: string;

  constructor(config: ApiConfig) {
    this.apiConfig = config;
    this.baseUrl = this.formatUrl(config.baseUrl);
  }
  
  private formatUrl(url: string): string {
    if (url.startsWith("/")) {
      return url.slice(1);
    }
    return url;
  }

  public async request<T>(endpoint: string, options: AxiosRequestConfig = {}): Promise<T> {
    const url = `${endpoint}`;
    
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
  
  // Graph Data
  public async getGraphData(jobId?: string, stackMode = false): Promise<GraphData> {
    const path = jobId 
      ? `call_graph?job_id=${jobId}${stackMode ? "&stack_mode=1" : ""}` 
      : "call_graph";
      
    const response = await this.request<ApiResponse<{ graphData: GraphData }>>(path);
    return response.data.graphData;
  }
  
  // Physical View Data
  public async getPhysicalViewData(jobId?: string): Promise<PhysicalViewData> {
    if (!jobId) {
      throw new Error("Job ID is required for physical view data");
    }
    
    const path = `physical_view?job_id=${jobId}`;
    const response = await this.request<ApiResponse<PhysicalViewData>>(path);
    return response.data;
  }
  
  // Flame Graph Data
  public async getFlameGraphData(jobId?: string): Promise<FlameGraphData> {
    if (!jobId) {
      throw new Error("Job ID is required for flame graph data");
    }
    
    const path = `flame_graph?job_id=${jobId}`;
    const response = await this.request<ApiResponse<{ flameData: FlameGraphData }>>(path);
    return response.data.flameData;
  }
  
  // Debug Sessions
  public async getDebugSessions(
    jobId: string,
    className?: string | null,
    funcName?: string | null,
    filterActive = false
  ): Promise<DebugSession[]> {
    let path = `get_debug_sessions?job_id=${jobId}&filter_active=${filterActive}`;
    
    if (className !== null && className !== undefined && className !== "") {
      path += `&class_name=${className}`;
    }
    
    if (funcName !== null) {
      path += `&func_name=${funcName}`;
    }
    
    const response = await this.request<ApiResponse<{ result: DebugSession[] }>>(path);
    return response.data.result;
  }
  
  // Active Debug Sessions
  public async getActiveDebugSessions(jobId: string): Promise<string[]> {
    const path = `get_active_debug_sessions?job_id=${jobId}`;
    const response = await this.request<ApiResponse<{ result: string[] }>>(path);
    return response.data.result;
  }
  
  // Breakpoints
  public async getBreakpoints(jobId: string, taskId: string): Promise<Breakpoint[]> {
    const path = `get_breakpoints?job_id=${jobId}&task_id=${taskId}`;
    const response = await this.request<ApiResponse<{ result: Breakpoint[] }>>(path);
    return response.data.result;
  }
  
  // Set Breakpoints
  public async setBreakpoints(
    jobId: string,
    taskId: string,
    breakpoints: Breakpoint[]
  ): Promise<boolean> {
    const breakpointsBase64 = btoa(JSON.stringify(breakpoints));
    const path = `set_breakpoints?job_id=${jobId}&task_id=${taskId}&breakpoints=${breakpointsBase64}`;
    const response = await this.request<ApiResponse<boolean>>(path);
    return response.result;
  }
  
  // Debug Commands
  public async sendDebugCommand(
    jobId: string,
    taskId: string,
    command: string,
    args: Record<string, any>
  ): Promise<any> {
    const argsBase64 = btoa(JSON.stringify(args));
    const path = `debug_cmd?job_id=${jobId}&task_id=${taskId}&command=${command}&args=${argsBase64}`;
    const response = await this.request<ApiResponse<{ result: any }>>(path);
    return response.data.result;
  }
  
  // Activate Debug Session
  public async activateDebugSession(
    jobId: string, 
    className: string, 
    funcName: string,
    taskId: string
  ): Promise<boolean> {
    const path = `activate_debug_session?job_id=${jobId}&class_name=${className}&func_name=${funcName}&task_id=${taskId}`;
    const response = await this.request<ApiResponse<boolean>>(path);
    return response.result;
  }
  
  // Deactivate Debug Session
  public async deactivateDebugSession(
    jobId: string,
    taskId: string
  ): Promise<boolean> {
    const path = `deactivate_debug_session?job_id=${jobId}&task_id=${taskId}`;
    const response = await this.request<ApiResponse<boolean>>(path);
    return response.result;
  }
  
  // Insight Analysis
  public async getInsightAnalyzePrompt(jobId: string): Promise<string> {
    const path = `get_insight_analyze_prompt?job_id=${jobId}`;
    const response = await this.request<ApiResponse<{ prompt: string }>>(path);
    return response.data.prompt;
  }
  
  // Store Breakpoints
  public async storeBreakpoints(
    jobId: string,
    taskId: string,
    breakpoints: Breakpoint[]
  ): Promise<boolean> {
    return this.setBreakpoints(jobId, taskId, breakpoints);
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
      console.error("Error counting tokens:", error);
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

    // First pass: collect all actor, method, and function IDs and their names
    if (result.actors) {
      result.actors.forEach((actor: any) => {
        if (actor.id && actor.name) {
          idToNameMap[actor.id] = actor.name;
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