import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { GraphData, PhysicalViewData, FlameGraphData } from '../types';

type GanttVisualizationProps = {
  flameData: FlameGraphData;
  onElementClick: (data: any, skip_zoom?: boolean) => void;
  selectedElementId: string | null;
  flowId?: string;
  onUpdate?: () => void;
  updating?: boolean;
  searchTerm?: string;
  graphData: GraphData;
  currentTimestamp?: number;
};

// Define handle type for export functionality
export type GanttVisualizationHandle = {
  exportSvg: () => void;
};

// Enhanced task interface with hierarchical tree support
interface CustomTask {
  id: string;
  name: string;
  fullName: string; // Full service:instance.method name
  startTime: number;
  endTime: number;
  progress: number;
  type: 'main' | 'method'; // method = function with execution count
  serviceName?: string;
  methodName?: string;
  parentId?: string;
  level: number; // 0 = main, 1 = service, 2 = method, 3 = execution
  isCollapsed?: boolean;
  children: CustomTask[];
  callers: string[]; // Who calls this
  callees: string[]; // Who this calls
  color?: string;
  executionCount?: number; // Number of executions
}

// Tree node structure for building hierarchy (matching FlameNode pattern)
interface TreeNode {
  id: string;
  name: string;
  fullName: string;
  type: 'method';
  serviceName?: string;
  methodName?: string;
  children: Map<string, TreeNode>;
  executions: Array<{
    startTime: number;
    endTime: number;
    type: 'completed' | 'running';
  }>;
  callers: Set<string>;
  callees: Set<string>;
  totalInParent?: Array<{
    callerNodeId: string;
    duration: number;
    count: number;
    startTime: number;
  }>;
  count?: number;
}

// Time scale modes
type TimeScale = 'milliseconds' | 'seconds' | 'minutes' | 'hours';

// Modern color palette
const COLORS = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  accent: '#ec4899',
  neutral: '#6b7280',
  background: '#f8fafc',
  surface: '#ffffff',
  border: '#e2e8f0',
  text: '#1e293b',
  textLight: '#64748b',
  grid: '#f1f5f9',
};

// Caller group colors for dependency-based grouping
const CALLER_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
];

const GanttVisualization = forwardRef<GanttVisualizationHandle, GanttVisualizationProps>(
  (
    {
      flameData,
      onElementClick,
      selectedElementId,
      searchTerm,
      graphData,
      currentTimestamp = Date.now(),
    },
    ref
  ) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [tasks, setTasks] = useState<CustomTask[]>([]);
    const [timeScale, setTimeScale] = useState<TimeScale>('seconds');
    const [zoomLevel, setZoomLevel] = useState(1);
    const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
    const [hoveredTask, setHoveredTask] = useState<{ id: string; index: number } | null>(null);
    const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

    // Chart dimensions
    const chartHeight = 500;
    const rowHeight = 40;
    const serviceRowHeight = 45;
    const methodRowHeight = 42;
    const labelWidth = 320;
    const timelineHeight = 50;
    const indentWidth = 20;

    // Transform flameData to hierarchical tree tasks
    const transformFlameDataToTreeTasks = (data: FlameGraphData): CustomTask[] => {
      if (!data || !data.aggregated || !Array.isArray(data.aggregated)) {
        console.warn('Invalid flame graph data format:', data);
        return [];
      }

      // Helper function to parse service.method from full name
      const parseServiceMethod = (
        fullName: string
      ): { serviceName: string; methodName: string; displayName: string } => {
        if (fullName === '_main') {
          return { serviceName: 'System', methodName: 'main', displayName: 'Main Execution Flow' };
        }

        const match = fullName.match(/^(.+?):(.+?)\.(.+)$/);
        if (match) {
          const [_, serviceName, _instanceId, methodName] = match;
          return {
            serviceName,
            methodName,
            displayName: `${serviceName}.${methodName}`,
          };
        }

        // Fallback for non-standard names
        const parts = fullName.split('.');
        if (parts.length >= 2) {
          return {
            serviceName: parts[0],
            methodName: parts[parts.length - 1],
            displayName: `${parts[0]}.${parts[parts.length - 1]}`,
          };
        }

        return { serviceName: 'Unknown', methodName: fullName, displayName: fullName };
      };

      // Build recursive call tree structure exactly like Flame.tsx
      const nodeMap = new Map<string, TreeNode>();
      const addedAsChild = new Set<string>();
      const allStartTimes: number[] = [];
      const allEndTimes: number[] = [];

      // Helper to get or create function node (matching Flame.tsx pattern)
      const getFunctionNode = (fullName: string): TreeNode => {
        if (!nodeMap.has(fullName)) {
          const { serviceName, methodName, displayName } = parseServiceMethod(fullName);
          const functionNode: TreeNode = {
            id: fullName,
            name: displayName,
            fullName,
            type: 'method',
            serviceName,
            methodName,
            children: new Map(),
            executions: [],
            callers: new Set(),
            callees: new Set(),
          };
          nodeMap.set(fullName, functionNode);
        }
        return nodeMap.get(fullName)!;
      };

      // Create main node
      const mainNode: TreeNode = {
        id: '_main',
        name: 'Main Execution Flow',
        fullName: '_main',
        type: 'method',
        serviceName: '_main',
        methodName: '_main',
        children: new Map(),
        executions: [],
        callers: new Set(),
        callees: new Set(),
      };
      nodeMap.set('_main', mainNode);

      // Process all aggregated data first to create base nodes (like Flame.tsx)
      data.aggregated.forEach(node => {
        const functionNode = getFunctionNode(node.name);
        // Store totalInParent data for hierarchy building
        functionNode.totalInParent = node.totalInParent;
        functionNode.count = node.count;
      });

      // fillParent function exactly like Flame.tsx
      const fillParent = (
        nodeMap: Map<string, TreeNode>,
        data: FlameGraphData,
        nodeData: TreeNode,
        callerNodeId: string,
        startTime: number,
        duration: number,
        count: number,
        isRunning: boolean
      ) => {
        addedAsChild.add(nodeData.fullName);
        const parentNode = nodeMap.get(callerNodeId);

        const nodeDataCopy: TreeNode = {
          id: nodeData.id,
          name: nodeData.name,
          fullName: nodeData.fullName,
          type: nodeData.type,
          serviceName: nodeData.serviceName,
          methodName: nodeData.methodName,
          children: new Map(nodeData.children),
          executions: [
            {
              startTime,
              endTime: startTime + duration * 1000,
              type: isRunning ? 'running' : 'completed',
            },
          ],
          callers: new Set(nodeData.callers),
          callees: new Set(nodeData.callees),
        };

        if (parentNode) {
          // Add as child to existing parent
          parentNode.children.set(nodeData.fullName, nodeDataCopy);
          return;
        } else {
          // Need to create parent hierarchy - recursive call like Flame.tsx
          const startTimesData = data.parentStartTimes?.find(
            item => item.calleeId === callerNodeId
          )?.startTimes;

          if (startTimesData) {
            for (const { callerId, startTime: parentStartTime } of startTimesData) {
              let originalValue = 0;
              if (parentStartTime > 0) {
                originalValue = (currentTimestamp - parentStartTime) / 1000;
              }

              // Ensure all parent nodes are visible
              if (originalValue <= 0) {
                originalValue = 0.001;
              }

              const parentDataCopy: TreeNode = {
                id: callerNodeId,
                name: parseServiceMethod(callerNodeId).displayName,
                fullName: callerNodeId,
                type: 'method',
                serviceName: parseServiceMethod(callerNodeId).serviceName,
                methodName: parseServiceMethod(callerNodeId).methodName,
                children: new Map([[nodeData.fullName, nodeDataCopy]]),
                executions: [
                  {
                    startTime: parentStartTime,
                    endTime: currentTimestamp,
                    type: 'running',
                  },
                ],
                callers: new Set(),
                callees: new Set([nodeData.fullName]),
              };
              nodeMap.set(callerNodeId, parentDataCopy);

              const ancestor = nodeMap.get(callerId);
              if (ancestor) {
                addedAsChild.add(callerNodeId);
                ancestor.children.set(callerNodeId, parentDataCopy);
              } else {
                fillParent(
                  nodeMap,
                  data,
                  parentDataCopy,
                  callerId,
                  parentStartTime,
                  originalValue,
                  1,
                  true
                );
              }
            }
          }
        }
      };

      // Second pass: build the hierarchy exactly like Flame.tsx
      nodeMap.forEach(nodeData => {
        const parentData = nodeData.totalInParent || [];

        // If this node has parents, add it as a child to each parent
        parentData.forEach(({ callerNodeId, duration, count, startTime }) => {
          if (startTime > 0 && duration > 0) {
            allStartTimes.push(startTime);
            allEndTimes.push(startTime + duration * 1000);
            fillParent(nodeMap, data, nodeData, callerNodeId, startTime, duration, count, false);
          }
        });
      });

      // Third pass: Process running tasks exactly like Flame.tsx
      if (data.parentStartTimes) {
        data.parentStartTimes.forEach(({ calleeId, startTimes }) => {
          startTimes.forEach(({ callerId, startTime }) => {
            let originalValue = 0;
            if (startTime > 0) {
              originalValue = (currentTimestamp - startTime) / 1000;
            }

            // Ensure running processes are always visible
            if (originalValue <= 0) {
              originalValue = 0.001;
            }

            allStartTimes.push(startTime);
            allEndTimes.push(currentTimestamp);

            const nodeDataCopy: TreeNode = {
              id: calleeId,
              name: parseServiceMethod(calleeId).displayName,
              fullName: calleeId,
              type: 'method',
              serviceName: parseServiceMethod(calleeId).serviceName,
              methodName: parseServiceMethod(calleeId).methodName,
              children: new Map(),
              executions: [
                {
                  startTime: startTime,
                  endTime: currentTimestamp,
                  type: 'running',
                },
              ],
              callers: new Set(),
              callees: new Set(),
            };

            if (!nodeMap.has(calleeId)) {
              nodeMap.set(calleeId, nodeDataCopy);
              fillParent(nodeMap, data, nodeDataCopy, callerId, startTime, originalValue, 1, true);
            }
          });
        });
      }

      // Fix children relationships recursively exactly like Flame.tsx
      while (true) {
        let changed = false;
        nodeMap.forEach(node => {
          const copyNode = (nodeData: TreeNode): TreeNode => {
            return {
              ...nodeData,
              children: new Map(nodeData.children),
              executions: [...nodeData.executions],
              callers: new Set(nodeData.callers),
              callees: new Set(nodeData.callees),
            };
          };

          const fixChildren = (nodeData: TreeNode): boolean => {
            let changed = false;
            const realNode = nodeMap.get(nodeData.fullName);

            // Create deep copies of children
            const newChildren = new Map<string, TreeNode>();
            if (realNode && realNode.children) {
              realNode.children.forEach((child, key) => {
                changed = changed || fixChildren(child);
                newChildren.set(key, copyNode(child));
              });
            }

            if (nodeData.children && nodeData.children.size !== newChildren.size) {
              changed = true;
            }
            nodeData.children = newChildren;
            return changed;
          };

          changed = changed || fixChildren(node);
        });

        if (!changed) {
          break;
        }
      }

      // Handle orphaned nodes exactly like Flame.tsx
      const childrenNodes = new Set<string>();
      if (mainNode.children) {
        mainNode.children.forEach(child => {
          childrenNodes.add(child.fullName);
        });
      }

      // Ensure all nodes from the original data are included
      const orphanedNodes = Array.from(nodeMap.values()).filter(
        node =>
          !addedAsChild.has(node.fullName) &&
          node.fullName !== '_main' &&
          !childrenNodes.has(node.fullName)
      );

      // Add orphaned nodes to main node
      orphanedNodes.forEach(orphanNode => {
        mainNode.children.set(orphanNode.fullName, orphanNode);
      });

      // Convert recursive call tree to flat task list
      const flatTasks: CustomTask[] = [];

      // Create main task if we have timing data
      if (allStartTimes.length > 0 && allEndTimes.length > 0) {
        const mainStartTime = Math.min(...allStartTimes);
        const mainEndTime = Math.max(...allEndTimes);

        flatTasks.push({
          id: 'main-task',
          name: 'Main Execution Flow',
          fullName: '_main',
          startTime: mainStartTime,
          endTime: mainEndTime,
          progress: 100,
          type: 'main',
          level: 0,
          children: [],
          callers: [],
          callees: [],
          color: COLORS.primary,
        });
      }

      // Recursive function to add function and its children to flat list
      const addFunctionToList = (
        functionNode: TreeNode,
        level: number,
        colorIndex: number,
        parentTaskId?: string
      ): void => {
        if (functionNode.executions.length === 0 && functionNode.children.size === 0) return;

        const functionColor = CALLER_COLORS[colorIndex % CALLER_COLORS.length];

        // Calculate function timing from all executions
        let functionStartTime = Infinity;
        let functionEndTime = 0;

        if (functionNode.executions.length > 0) {
          functionStartTime = Math.min(...functionNode.executions.map(e => e.startTime));
          functionEndTime = Math.max(...functionNode.executions.map(e => e.endTime));
        } else if (functionNode.children.size > 0) {
          // If no direct executions, use children timing
          const childExecutions: any[] = [];
          functionNode.children.forEach(child => {
            childExecutions.push(...child.executions);
          });
          if (childExecutions.length > 0) {
            functionStartTime = Math.min(...childExecutions.map(e => e.startTime));
            functionEndTime = Math.max(...childExecutions.map(e => e.endTime));
          }
        }

        if (functionStartTime === Infinity) {
          functionStartTime = allStartTimes.length > 0 ? Math.min(...allStartTimes) : 0;
          functionEndTime = allEndTimes.length > 0 ? Math.max(...allEndTimes) : 1000;
        }

        // Add function task
        const functionTask: CustomTask = {
          id: functionNode.id,
          name: `${functionNode.name} (${functionNode.executions.length}x)`,
          fullName: functionNode.fullName,
          startTime: functionStartTime,
          endTime: functionEndTime,
          progress: 100,
          type: 'method',
          serviceName: functionNode.serviceName,
          methodName: functionNode.methodName,
          parentId: parentTaskId, // Set the parent ID for proper tree collapse
          level: level,
          children: [],
          callers: Array.from(functionNode.callers),
          callees: Array.from(functionNode.callees),
          color: functionColor,
          executionCount: functionNode.executions.length,
        };
        flatTasks.push(functionTask);

        // Skip individual execution tasks - showing count in function name is sufficient

        // Recursively add child functions (callees) in proper order
        const sortedCallees = Array.from(functionNode.children.values()).sort((a, b) => {
          const aStart =
            a.executions.length > 0 ? Math.min(...a.executions.map(e => e.startTime)) : 0;
          const bStart =
            b.executions.length > 0 ? Math.min(...b.executions.map(e => e.startTime)) : 0;
          return aStart - bStart;
        });

        sortedCallees.forEach(calleeNode => {
          addFunctionToList(calleeNode, level + 1, colorIndex + 1, functionTask.id);
        });
      };

      // Add main node and its recursive call tree
      if (mainNode.children.size > 0) {
        const sortedMainChildren = Array.from(mainNode.children.values()).sort((a, b) => {
          const aStart =
            a.executions.length > 0 ? Math.min(...a.executions.map(e => e.startTime)) : 0;
          const bStart =
            b.executions.length > 0 ? Math.min(...b.executions.map(e => e.startTime)) : 0;
          return aStart - bStart;
        });

        sortedMainChildren.forEach((rootFunction, index) => {
          addFunctionToList(rootFunction, 1, index, 'main-task');
        });
      }

      console.log(
        `Created recursive call tree with ${flatTasks.length} total tasks, ${mainNode.children.size} root functions`
      );
      return flatTasks;
    };

    // Get visible tasks based on collapsed nodes in call tree hierarchy
    const getVisibleTasks = (): CustomTask[] => {
      const visibleTasks: CustomTask[] = [];

      // Build a map of parent-child relationships from the task list
      const childrenMap = new Map<string, CustomTask[]>();
      const parentMap = new Map<string, string>();

      tasks.forEach(task => {
        if (task.parentId) {
          parentMap.set(task.id, task.parentId);
          if (!childrenMap.has(task.parentId)) {
            childrenMap.set(task.parentId, []);
          }
          childrenMap.get(task.parentId)!.push(task);
        }
      });

      // Helper function to check if any ancestor is collapsed
      const isAncestorCollapsed = (taskId: string): boolean => {
        const parentId = parentMap.get(taskId);
        if (!parentId) {
          return false; // No parent, so not collapsed by ancestor
        }

        if (collapsedNodes.has(parentId)) {
          return true; // Direct parent is collapsed
        }

        return isAncestorCollapsed(parentId); // Check recursively up the tree
      };

      // Add tasks that should be visible
      tasks.forEach(task => {
        // Always show main task
        if (task.type === 'main') {
          visibleTasks.push({
            ...task,
            isCollapsed: collapsedNodes.has(task.id),
          });
          return;
        }

        // Show method tasks if no ancestor is collapsed
        if (task.type === 'method') {
          if (!isAncestorCollapsed(task.id)) {
            visibleTasks.push({
              ...task,
              isCollapsed: collapsedNodes.has(task.id),
            });
          }
        }
      });

      return visibleTasks;
    };

    // Calculate time scale parameters
    const getTimeScaleInfo = (tasks: CustomTask[], scale: TimeScale) => {
      if (tasks.length === 0) {
        return { minTime: 0, maxTime: 1000, pixelsPerUnit: 1, unitLabel: 'ms' };
      }

      const minTime = Math.min(...tasks.map(t => t.startTime));
      const maxTime = Math.max(...tasks.map(t => t.endTime));
      const totalDuration = maxTime - minTime;

      let pixelsPerUnit: number;
      let unitLabel: string;

      switch (scale) {
        case 'milliseconds':
          pixelsPerUnit = Math.max(0.5, 1200 / totalDuration) * zoomLevel;
          unitLabel = 'ms';
          break;
        case 'seconds':
          pixelsPerUnit = Math.max(80, 1200 / (totalDuration / 1000)) * zoomLevel;
          unitLabel = 's';
          break;
        case 'minutes':
          pixelsPerUnit = Math.max(50, 1200 / (totalDuration / 60000)) * zoomLevel;
          unitLabel = 'min';
          break;
        case 'hours':
          pixelsPerUnit = Math.max(30, 1200 / (totalDuration / 3600000)) * zoomLevel;
          unitLabel = 'h';
          break;
        default:
          pixelsPerUnit = 1;
          unitLabel = 'ms';
      }

      return { minTime, maxTime, pixelsPerUnit, unitLabel };
    };

    // Convert time to x position
    const timeToX = (
      time: number,
      minTime: number,
      pixelsPerUnit: number,
      scale: TimeScale
    ): number => {
      const relativeTime = time - minTime;

      switch (scale) {
        case 'milliseconds':
          return relativeTime * pixelsPerUnit;
        case 'seconds':
          return (relativeTime / 1000) * pixelsPerUnit;
        case 'minutes':
          return (relativeTime / 60000) * pixelsPerUnit;
        case 'hours':
          return (relativeTime / 3600000) * pixelsPerUnit;
        default:
          return relativeTime * pixelsPerUnit;
      }
    };

    // Format time for display
    const formatTime = (time: number, minTime: number, scale: TimeScale): string => {
      const relativeTime = time - minTime;

      switch (scale) {
        case 'milliseconds':
          return `${relativeTime.toFixed(0)}ms`;
        case 'seconds':
          return `${(relativeTime / 1000).toFixed(2)}s`;
        case 'minutes':
          return `${(relativeTime / 60000).toFixed(2)}min`;
        case 'hours':
          return `${(relativeTime / 3600000).toFixed(2)}h`;
        default:
          return `${relativeTime.toFixed(0)}ms`;
      }
    };

    // Handle task click
    const handleTaskClick = (task: CustomTask) => {
      // Handle collapse/expand for method nodes (functions)
      if (task.type === 'method') {
        const newCollapsed = new Set(collapsedNodes);
        if (newCollapsed.has(task.id)) {
          newCollapsed.delete(task.id);
        } else {
          newCollapsed.add(task.id);
        }
        setCollapsedNodes(newCollapsed);

        // Also handle function inspection on method click
        const taskName = task.methodName || task.name;
        const durationSeconds = (task.endTime - task.startTime) / 1000;

        let elementData: any = {
          id: task.id,
          type: 'function',
          name: taskName,
          data: {
            startTime: new Date(task.startTime),
            endTime: new Date(task.endTime),
            duration: durationSeconds,
            progress: task.progress,
          },
        };

        // Look for matching method in graphData
        if (graphData) {
          const method = graphData.methods.find(
            m => taskName.includes(m.name) || m.name.includes(taskName.split('.').pop() || '')
          );

          if (method) {
            elementData = {
              id: method.id,
              type: 'method',
              name: method.name,
              instanceId: method.instanceId,
              serviceName: method.serviceName,
              data: elementData.data,
            };
          } else {
            const func = graphData.functions.find(f => f.name === taskName);
            if (func) {
              elementData = {
                id: func.id,
                type: 'function',
                name: func.name,
                data: elementData.data,
              };
            }
          }
        }

        onElementClick(elementData, true);
        return;
      }

      // Don't handle clicks on main task
      if (task.type === 'main') return;
    };

    // Update tasks when flameData changes
    useEffect(() => {
      if (flameData) {
        const newTasks = transformFlameDataToTreeTasks(flameData);
        setTasks(newTasks);
      }
    }, [flameData, currentTimestamp]);

    // Filter tasks based on search term
    const visibleTasks = getVisibleTasks();
    const filteredTasks =
      searchTerm && searchTerm.trim() !== ''
        ? visibleTasks.filter(task => task.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : visibleTasks;

    // Export SVG functionality
    const exportSvg = () => {
      if (!svgRef.current) {
        console.warn('SVG element not found');
        return;
      }

      const svgElement = svgRef.current;
      const svgCopy = svgElement.cloneNode(true) as SVGSVGElement;

      svgCopy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgCopy.setAttribute('width', svgElement.clientWidth.toString());
      svgCopy.setAttribute('height', svgElement.clientHeight.toString());

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgCopy);
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `flow-insight-gantt-${new Date().toISOString().slice(0, 10)}.svg`;
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    useImperativeHandle(ref, () => ({
      exportSvg,
    }));

    if (!flameData || filteredTasks.length === 0) {
      return (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '500px',
            backgroundColor: COLORS.background,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '12px',
            margin: '20px 0',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          }}
        >
          <div style={{ textAlign: 'center', color: COLORS.textLight }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
            <h3 style={{ margin: '0 0 8px 0', color: COLORS.text }}>No Gantt Data Available</h3>
            <p style={{ margin: 0 }}>
              {!flameData
                ? 'No flame data provided for Gantt visualization'
                : 'No tasks match the current search criteria'}
            </p>
          </div>
        </div>
      );
    }

    const { minTime, maxTime, pixelsPerUnit, unitLabel } = getTimeScaleInfo(
      filteredTasks,
      timeScale
    );

    // Extend timeline beyond execution flow for better visualization
    const executionWidth = timeToX(maxTime, minTime, pixelsPerUnit, timeScale);
    const timelinePadding = executionWidth * 0.2; // 20% padding on each side
    const chartWidth = Math.max(1200, labelWidth + executionWidth + timelinePadding + 200);

    // Calculate total height with proper spacing for each task type
    let totalHeight = timelineHeight + 60;
    filteredTasks.forEach(task => {
      if (task.type === 'method') {
        totalHeight += methodRowHeight;
      } else {
        totalHeight += rowHeight;
      }
    });

    // Generate timeline ticks extending beyond execution flow
    const generateTimelineTicks = () => {
      const ticks = [];
      const totalDuration = maxTime - minTime;
      const extendedDuration = totalDuration * 1.4; // Extend 40% beyond actual duration

      let tickInterval: number;

      switch (timeScale) {
        case 'milliseconds':
          tickInterval = Math.max(1, Math.round(totalDuration / 15));
          break;
        case 'seconds':
          tickInterval = Math.max(100, Math.round(totalDuration / 1000 / 15) * 1000);
          break;
        case 'minutes':
          tickInterval = Math.max(5000, Math.round(totalDuration / 60000 / 15) * 60000);
          break;
        case 'hours':
          tickInterval = Math.max(300000, Math.round(totalDuration / 3600000 / 15) * 3600000);
          break;
        default:
          tickInterval = 1000;
      }

      // Start before minTime and extend beyond maxTime
      const startTime = minTime - totalDuration * 0.1;
      const endTime = maxTime + totalDuration * 0.3;

      for (let time = startTime; time <= endTime; time += tickInterval) {
        ticks.push(time);
      }

      return ticks;
    };

    const timelineTicks = generateTimelineTicks();

    return (
      <div
        ref={containerRef}
        className="gantt-container"
        style={{
          width: '100%',
          height: '700px',
          padding: '24px',
          backgroundColor: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: '16px',
          margin: '20px 0',
          overflow: 'hidden',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif',
        }}
      >
        {/* Controls and Info */}
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', color: COLORS.textLight, fontWeight: '500' }}>
                {filteredTasks.length} visible • {tasks.filter(t => t.type === 'method').length}{' '}
                functions
              </span>
            </div>
          </div>

          {/* Controls Row */}
          <div
            style={{
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              marginBottom: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontWeight: '600', fontSize: '14px', color: COLORS.text }}>
                Time Scale:
              </span>
              {(['milliseconds', 'seconds', 'minutes', 'hours'] as TimeScale[]).map(scale => (
                <button
                  key={scale}
                  onClick={() => setTimeScale(scale)}
                  style={{
                    padding: '8px 16px',
                    border: timeScale === scale ? 'none' : `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    backgroundColor: timeScale === scale ? COLORS.primary : COLORS.surface,
                    color: timeScale === scale ? 'white' : COLORS.text,
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    textTransform: 'capitalize',
                    transition: 'all 0.2s ease',
                    boxShadow:
                      timeScale === scale ? '0 4px 6px -1px rgba(99, 102, 241, 0.2)' : 'none',
                  }}
                >
                  {scale}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontWeight: '600', fontSize: '14px', color: COLORS.text }}>Zoom:</span>
              <button
                onClick={() => setZoomLevel(prev => Math.max(0.1, prev / 1.5))}
                style={{
                  padding: '8px 12px',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '8px',
                  backgroundColor: COLORS.surface,
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                }}
              >
                🔍-
              </button>
              <span
                style={{
                  fontSize: '13px',
                  color: COLORS.textLight,
                  fontWeight: '600',
                  minWidth: '60px',
                  textAlign: 'center',
                }}
              >
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                onClick={() => setZoomLevel(prev => Math.min(10, prev * 1.5))}
                style={{
                  padding: '8px 12px',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '8px',
                  backgroundColor: COLORS.surface,
                  color: COLORS.text,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease',
                }}
              >
                🔍+
              </button>
            </div>

            <div
              style={{
                padding: '8px 12px',
                backgroundColor: COLORS.background,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                fontSize: '13px',
                color: COLORS.textLight,
                fontWeight: '500',
              }}
            >
              Duration: {formatTime(maxTime, minTime, timeScale)} • Scale: {unitLabel}
            </div>
          </div>

          {/* Modern Legend */}
          <div
            style={{
              display: 'flex',
              gap: '20px',
              fontSize: '12px',
              color: COLORS.textLight,
              flexWrap: 'wrap',
              padding: '12px',
              backgroundColor: COLORS.background,
              borderRadius: '8px',
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '16px',
                  height: '12px',
                  background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary})`,
                  borderRadius: '3px',
                  boxShadow: '0 2px 4px rgba(99, 102, 241, 0.2)',
                }}
              ></div>
              <span style={{ fontWeight: '500' }}>Main Flow</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '16px',
                  height: '12px',
                  backgroundColor: COLORS.info,
                  borderRadius: '3px',
                  boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)',
                }}
              ></div>
              <span style={{ fontWeight: '500' }}>Function Calls (click to expand/collapse)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '16px',
                  height: '12px',
                  backgroundColor: COLORS.success,
                  borderRadius: '3px',
                  boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                }}
              ></div>
              <span style={{ fontWeight: '500' }}>Completed Tasks</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '16px',
                  height: '12px',
                  backgroundColor: COLORS.warning,
                  borderRadius: '3px',
                  boxShadow: '0 2px 4px rgba(245, 158, 11, 0.2)',
                }}
              ></div>
              <span style={{ fontWeight: '500' }}>Running Tasks</span>
            </div>
            <span style={{ fontStyle: 'italic', color: COLORS.textLight }}>
              💡 Click tasks to inspect • Hover for details • Zoom for precision
            </span>
          </div>
        </div>

        {/* Enhanced SVG Gantt Chart with Horizontal Scroll */}
        <div
          style={{
            backgroundColor: COLORS.surface,
            borderRadius: '12px',
            border: `1px solid ${COLORS.border}`,
            overflow: 'auto',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            maxHeight: '500px',
            width: '100%',
            position: 'relative', // Ensure proper stacking context for tooltips
          }}
        >
          <svg
            ref={svgRef}
            width={chartWidth}
            height={totalHeight}
            style={{ display: 'block', minWidth: '100%' }}
          >
            {/* Gradient definitions */}
            <defs>
              <linearGradient id="mainGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={COLORS.primary} />
                <stop offset="100%" stopColor={COLORS.secondary} />
              </linearGradient>
              <linearGradient id="completedGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={COLORS.success} />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
              <linearGradient id="runningGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={COLORS.warning} />
                <stop offset="100%" stopColor="#fbbf24" />
              </linearGradient>
              <filter id="dropShadow">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.1" />
              </filter>
            </defs>

            {/* Modern Timeline */}
            <g>
              {/* Timeline background covering full width */}
              <rect
                x={0}
                y={0}
                width={chartWidth}
                height={timelineHeight}
                fill="url(#mainGradient)"
                opacity={0.05}
              />

              {/* Chart area background */}
              <rect
                x={labelWidth}
                y={0}
                width={chartWidth - labelWidth}
                height={timelineHeight}
                fill="url(#mainGradient)"
                opacity={0.1}
              />

              {/* Timeline border */}
              <line
                x1={0}
                y1={timelineHeight}
                x2={chartWidth}
                y2={timelineHeight}
                stroke={COLORS.border}
                strokeWidth={2}
              />

              {/* Timeline ticks and labels */}
              {timelineTicks.map((time, index) => {
                const x = labelWidth + timeToX(time, minTime, pixelsPerUnit, timeScale);
                // Only show ticks that are within the visible chart area
                if (x >= labelWidth && x <= chartWidth) {
                  return (
                    <g key={index}>
                      <line
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={totalHeight}
                        stroke={COLORS.grid}
                        strokeWidth={0.5}
                        opacity={0.6}
                      />
                      <rect
                        x={Math.max(labelWidth + 2, x - 25)}
                        y={8}
                        width={50}
                        height={20}
                        fill={COLORS.surface}
                        stroke={COLORS.border}
                        strokeWidth={1}
                        rx={4}
                        opacity={0.9}
                      />
                      <text
                        x={x}
                        y={22}
                        textAnchor="middle"
                        fontSize="11"
                        fill={COLORS.text}
                        fontWeight="600"
                      >
                        {formatTime(time, minTime, timeScale)}
                      </text>
                    </g>
                  );
                }
                return null;
              })}
            </g>

            {/* Enhanced Task Rows with Tree Structure */}
            {filteredTasks.map((task, index) => {
              // Calculate y position with proper spacing for different row heights
              let y = timelineHeight + 20;
              for (let i = 0; i < index; i++) {
                const prevTask = filteredTasks[i];
                if (prevTask.type === 'method') {
                  y += methodRowHeight;
                } else {
                  y += rowHeight;
                }
              }
              const taskStartX =
                labelWidth + timeToX(task.startTime, minTime, pixelsPerUnit, timeScale);
              const taskEndX =
                labelWidth + timeToX(task.endTime, minTime, pixelsPerUnit, timeScale);
              const taskWidth = Math.max(3, taskEndX - taskStartX);

              const isMethod = task.type === 'method';
              const isMain = task.type === 'main';
              const isHovered = hoveredTask?.id === task.id && hoveredTask?.index === index;
              const isSelected = selectedElementId === task.id;
              const isCollapsible = isMethod;

              const currentRowHeight = isMethod ? methodRowHeight : rowHeight;
              const barHeight = currentRowHeight - 12;
              const indent = task.level * indentWidth;

              let taskColor = task.color || COLORS.neutral;
              let gradientId = 'completedGradient';

              if (isMain) {
                gradientId = 'mainGradient';
                taskColor = COLORS.primary;
              } else if (isMethod) {
                gradientId = 'completedGradient';
                taskColor = task.color || COLORS.info;
              } else if (task.name.includes('🔄')) {
                gradientId = 'runningGradient';
                taskColor = COLORS.warning;
              }

              const duration = (task.endTime - task.startTime) / 1000;

              return (
                <g key={task.id}>
                  {/* Enhanced Row Background */}
                  <rect
                    x={0}
                    y={y - 5}
                    width={chartWidth}
                    height={currentRowHeight}
                    fill={
                      isSelected ? '#f0f9ff' : index % 2 === 0 ? COLORS.surface : COLORS.background
                    }
                    stroke={isSelected ? COLORS.info : 'transparent'}
                    strokeWidth={isSelected ? 2 : 0}
                    rx={isSelected ? 8 : 0}
                    opacity={isHovered ? 0.8 : 1}
                    style={{ transition: 'all 0.2s ease' }}
                  />

                  {/* Task Label with Tree Structure */}
                  <g>
                    {/* Tree expand/collapse icon */}
                    {isCollapsible && (
                      <text
                        x={indent + 15}
                        y={y + currentRowHeight / 2 + 2}
                        fontSize="12"
                        fill={taskColor}
                        textAnchor="middle"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleTaskClick(task)}
                      >
                        {task.isCollapsed ? '▶' : '▼'}
                      </text>
                    )}

                    {/* Tree indentation lines */}
                    {task.level > 0 && (
                      <g>
                        {/* Horizontal connector */}
                        <line
                          x1={indent}
                          y1={y + currentRowHeight / 2}
                          x2={indent + 12}
                          y2={y + currentRowHeight / 2}
                          stroke={COLORS.border}
                          strokeWidth={1}
                        />
                        {/* Vertical connector */}
                        <line
                          x1={indent}
                          y1={y - 10}
                          x2={indent}
                          y2={y + currentRowHeight / 2}
                          stroke={COLORS.border}
                          strokeWidth={1}
                        />
                      </g>
                    )}

                    {/* Method/Function icon */}
                    {isMethod && (
                      <text
                        x={indent + (isCollapsible ? 35 : 15)}
                        y={y + currentRowHeight / 2 + 2}
                        fontSize="12"
                        fill={taskColor}
                        textAnchor="start"
                      >
                        📞
                      </text>
                    )}

                    {/* Task name */}
                    <text
                      x={indent + (isCollapsible ? 52 : isMethod ? 32 : 15)}
                      y={y + currentRowHeight / 2 - 2}
                      fontSize={isMain ? '14' : isMethod ? '12' : '11'}
                      fill={isMain ? COLORS.primary : COLORS.text}
                      textAnchor="start"
                      fontWeight={isMain ? '700' : isMethod ? '600' : '500'}
                      style={{
                        userSelect: 'none',
                        cursor: isCollapsible ? 'pointer' : 'default',
                      }}
                      onClick={() => isCollapsible && handleTaskClick(task)}
                    >
                      {task.name}
                    </text>

                    {/* Call relationship indicators */}
                    {task.callers.length > 0 && (
                      <text
                        x={indent + (isCollapsible ? 52 : isMethod ? 32 : 15)}
                        y={y + currentRowHeight / 2 + 12}
                        fontSize="9"
                        fill={COLORS.textLight}
                        textAnchor="start"
                        fontWeight="400"
                      >
                        📞 Called by: {task.callers.length} • Calls: {task.callees.length}
                      </text>
                    )}

                    {/* Duration info */}
                    {!isMethod && (
                      <text
                        x={indent + (isCollapsible ? 52 : isMethod ? 32 : 15)}
                        y={y + currentRowHeight / 2 + (task.callers.length > 0 ? 22 : 12)}
                        fontSize="9"
                        fill={COLORS.textLight}
                        textAnchor="start"
                        fontWeight="400"
                      >
                        ⏱️ {duration.toFixed(3)}s
                      </text>
                    )}
                  </g>

                  {/* Enhanced Task Bar */}
                  <g
                    style={{
                      cursor: isCollapsible ? 'pointer' : 'default',
                      pointerEvents: 'all', // Ensure mouse events are captured
                    }}
                    onMouseEnter={e => {
                      console.log('Mouse enter on task:', task.name, 'at y:', y); // Debug log
                      setHoveredTask({ id: task.id, index });

                      // Get mouse position relative to the container
                      const rect = containerRef.current?.getBoundingClientRect();
                      if (rect) {
                        setTooltipPosition({
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                        });
                      }
                    }}
                    onMouseLeave={e => {
                      console.log('Mouse leave on task:', task.name); // Debug log
                      setHoveredTask(null);
                      setTooltipPosition(null);
                    }}
                    onMouseMove={e => {
                      // Update tooltip position as mouse moves
                      if (hoveredTask?.id === task.id) {
                        const rect = containerRef.current?.getBoundingClientRect();
                        if (rect) {
                          setTooltipPosition({
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                          });
                        }
                      }
                    }}
                    onClick={() => handleTaskClick(task)}
                  >
                    {/* Shadow */}
                    <rect
                      x={taskStartX + 2}
                      y={y + 8}
                      width={taskWidth}
                      height={barHeight}
                      fill="rgba(0,0,0,0.1)"
                      rx={6}
                    />

                    {/* Main bar */}
                    <rect
                      x={taskStartX}
                      y={y + 6}
                      width={taskWidth}
                      height={barHeight}
                      fill={`url(#${gradientId})`}
                      stroke={isHovered ? 'white' : taskColor}
                      strokeWidth={isHovered ? 3 : 1}
                      rx={isMethod ? 6 : 4}
                      opacity={isHovered ? 0.9 : isMethod ? 0.8 : 0.85}
                      filter="url(#dropShadow)"
                      style={{ transition: 'all 0.2s ease' }}
                    />

                    {/* Running task indicator */}
                    {task.name.includes('🔄') && (
                      <rect
                        x={taskStartX + 2}
                        y={y + 8}
                        width={taskWidth - 4}
                        height={barHeight - 4}
                        fill="rgba(255,255,255,0.2)"
                        rx={4}
                      />
                    )}

                    {/* Duration label on bar */}
                    {taskWidth > 70 && (
                      <text
                        x={taskStartX + taskWidth / 2}
                        y={y + currentRowHeight / 2 + 1}
                        textAnchor="middle"
                        fontSize="10"
                        fill="white"
                        fontWeight="700"
                        style={{
                          textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                          pointerEvents: 'none',
                        }}
                      >
                        {duration.toFixed(2)}s
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Floating tooltip - outside SVG container to avoid clipping */}
        {hoveredTask &&
          tooltipPosition &&
          (() => {
            const task = filteredTasks.find(t => t.id === hoveredTask.id);
            if (!task) return null;

            const duration = (task.endTime - task.startTime) / 1000;
            const tooltipWidth = 220;
            const tooltipHeight = 90;

            // Get container dimensions
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (!containerRect) return null;

            // Calculate position relative to container
            let tooltipX = tooltipPosition.x + 15; // Offset from cursor
            let tooltipY = tooltipPosition.y - tooltipHeight - 10; // Above cursor

            // Ensure tooltip stays within container bounds
            if (tooltipX + tooltipWidth > containerRect.width) {
              tooltipX = tooltipPosition.x - tooltipWidth - 15; // Show to the left
            }
            if (tooltipY < 0) {
              tooltipY = tooltipPosition.y + 15; // Show below cursor
            }

            return (
              <div
                style={{
                  position: 'absolute',
                  left: tooltipX,
                  top: tooltipY,
                  width: tooltipWidth,
                  height: tooltipHeight,
                  backgroundColor: COLORS.text,
                  color: 'white',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '11px',
                  pointerEvents: 'none',
                  zIndex: 1000,
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  opacity: 0.95,
                }}
              >
                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                  {task.name.length > 25 ? task.name.substring(0, 25) + '...' : task.name}
                </div>
                <div style={{ fontSize: '10px', opacity: 0.8, marginBottom: '2px' }}>
                  Duration: {duration.toFixed(3)}s
                </div>
                <div style={{ fontSize: '10px', opacity: 0.8, marginBottom: '2px' }}>
                  Type: {task.type} • Level: {task.level}
                </div>
                {task.callers.length > 0 && (
                  <div style={{ fontSize: '9px', opacity: 0.7 }}>
                    Callers: {task.callers.length} • Callees: {task.callees.length}
                  </div>
                )}
              </div>
            );
          })()}
      </div>
    );
  }
);

export default GanttVisualization;
