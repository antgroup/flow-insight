import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { GraphData, PhysicalViewData, FlameGraphData } from '../types';
import { buildCompleteHierarchy, HierarchyNode } from './Flame';

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
    const rowHeight = 20;
    const serviceRowHeight = 22;
    const methodRowHeight = 21;
    const labelWidth = 320;
    const timelineHeight = 50;
    const indentWidth = 20;

    // Transform flameData to hierarchical tree tasks using the shared hierarchy builder
    const transformFlameDataToTreeTasks = (data: FlameGraphData): CustomTask[] => {
      if (!data || !data.aggregated || !Array.isArray(data.aggregated)) {
        console.warn('Invalid flame graph data format:', data);
        return [];
      }

      // Use the exported hierarchy building function from Flame.tsx
      const hierarchyRoot = buildCompleteHierarchy(data, currentTimestamp);

      // Helper function to parse service.method from full name
      const parseServiceMethod = (
        fullName: string
      ): { serviceName: string; methodName: string; displayName: string } => {
        // Clean the name by removing span suffixes (like @spanId) added by buildCompleteHierarchy
        let cleanName = fullName;

        // Remove span suffix if present (everything after the last @)
        const lastAtIndex = cleanName.lastIndexOf('@');
        if (lastAtIndex !== -1) {
          cleanName = cleanName.substring(0, lastAtIndex);
        }

        if (cleanName === '_main') {
          return { serviceName: 'System', methodName: 'main', displayName: 'Main Execution Flow' };
        }

        const match = cleanName.match(/^(.+?):(.+?)\.(.+)$/);
        if (match) {
          const [_, serviceName, _instanceId, methodName] = match;
          return {
            serviceName,
            methodName,
            displayName: `${serviceName}.${methodName}`,
          };
        }

        // Fallback for non-standard names
        const parts = cleanName.split('.');
        if (parts.length >= 2) {
          return {
            serviceName: parts[0],
            methodName: parts[parts.length - 1],
            displayName: `${parts[0]}.${parts[parts.length - 1]}`,
          };
        }

        return { serviceName: 'Unknown', methodName: cleanName, displayName: cleanName };
      };

      // Convert HierarchyNode tree to flat task list with proper timing
      const flatTasks: CustomTask[] = [];
      const allStartTimes: number[] = [];
      const allEndTimes: number[] = [];

      // Collect all timing information from the hierarchy
      const collectTimings = (node: HierarchyNode): void => {
        if (node.startTime) {
          allStartTimes.push(node.startTime);
          if (node.originalValue) {
            allEndTimes.push(node.startTime + node.originalValue * 1000);
          }
        }

        if (node.children) {
          node.children.forEach(child => collectTimings(child));
        }
      };

      collectTimings(hierarchyRoot);

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

      // Recursive function to convert hierarchy nodes to tasks
      const convertHierarchyToTasks = (
        node: HierarchyNode,
        level: number,
        colorIndex: number,
        parentTaskId?: string
      ): void => {
        if (node.name === '_main' && level === 0) {
          // Skip the root main node, process its children directly
          if (node.children) {
            node.children.forEach((child, index) => {
              convertHierarchyToTasks(child, level + 1, index, undefined);
            });
          }
          return;
        }

        const { serviceName, methodName, displayName } = parseServiceMethod(node.name);
        const functionColor = CALLER_COLORS[colorIndex % CALLER_COLORS.length];

        // Calculate timing from node data
        let startTime = 0;
        let endTime = 1000;

        if (node.startTime && node.originalValue) {
          startTime = node.startTime;
          endTime = node.startTime + node.originalValue * 1000;
        } else if (allStartTimes.length > 0) {
          // Use overall timing as fallback
          startTime = Math.min(...allStartTimes);
          endTime = Math.max(...allEndTimes);
        }

        // Generate unique ID
        const uniqueId = `${node.name}_${level}_${flatTasks.length}_${startTime}`;

        // Count is either from the node or default to 1
        const executionCount = node.count || 1;

        const task: CustomTask = {
          id: uniqueId,
          name: `${displayName} (${executionCount}x)`,
          fullName: node.name,
          startTime: startTime,
          endTime: endTime,
          progress: 100,
          type: 'method',
          serviceName: serviceName,
          methodName: methodName,
          parentId: parentTaskId,
          level: level,
          children: [],
          callers: [], // Can be enhanced based on hierarchy relationships
          callees: [],
          color: functionColor,
          executionCount: executionCount,
        };

        flatTasks.push(task);

        // Recursively process children
        if (node.children && node.children.length > 0) {
          // Sort children by start time if available
          const sortedChildren = [...node.children].sort((a, b) => {
            const aStart = a.startTime || 0;
            const bStart = b.startTime || 0;
            return aStart - bStart;
          });

          sortedChildren.forEach((child, index) => {
            convertHierarchyToTasks(child, level + 1, colorIndex + index + 1, uniqueId);
          });
        }
      };

      // Convert the hierarchy to flat tasks
      convertHierarchyToTasks(hierarchyRoot, 0, 0);

      console.log(
        `Created gantt chart with ${flatTasks.length} total tasks from hierarchy with ${hierarchyRoot.children?.length || 0} root functions`
      );
      return flatTasks;
    };

    // Get visible tasks based on collapsed nodes in call tree hierarchy
    const getVisibleTasks = (): CustomTask[] => {
      const visibleTasks: CustomTask[] = [];

      // Build a map of parent-child relationships from the task list
      const childrenMap = new Map<string, CustomTask[]>();
      const parentMap = new Map<string, string | undefined>();

      tasks.forEach(task => {
        if (task.parentId) {
          parentMap.set(task.id, task.parentId);
          if (!childrenMap.has(task.parentId)) {
            childrenMap.set(task.parentId, []);
          }
          childrenMap.get(task.parentId)!.push(task);
        } else {
          parentMap.set(task.id, undefined); // Explicitly mark root-level tasks
        }
      });

      // Helper function to check if any ancestor is collapsed
      const isAncestorCollapsed = (taskId: string): boolean => {
        let currentTaskId = taskId;
        const visited = new Set<string>(); // Prevent infinite loops

        while (currentTaskId && !visited.has(currentTaskId)) {
          visited.add(currentTaskId);
          const parentId = parentMap.get(currentTaskId);

          if (!parentId) {
            return false; // Reached root, no collapsed ancestor
          }

          if (collapsedNodes.has(parentId)) {
            return true; // Found a collapsed ancestor
          }

          currentTaskId = parentId;
        }

        return false; // No collapsed ancestor found or circular reference detected
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
          console.log(`Expanding task: ${task.name} (ID: ${task.id})`);
          newCollapsed.delete(task.id);
        } else {
          console.log(`Collapsing task: ${task.name} (ID: ${task.id})`);
          newCollapsed.add(task.id);
        }
        console.log('Current collapsed nodes:', Array.from(newCollapsed));
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

      // Calculate available width for timeline labels
      const timelineWidth = chartWidth - labelWidth;
      const minLabelWidth = 50; // Reduced minimum space for more labels
      const maxTicks = Math.floor(timelineWidth / minLabelWidth);
      const targetTicks = Math.max(4, Math.min(maxTicks, 15)); // Ensure at least 4 ticks, max 15

      let tickInterval: number;
      const baseDivisions = Math.max(4, targetTicks - 2); // Ensure minimum 4 divisions

      switch (timeScale) {
        case 'milliseconds':
          // For milliseconds, use nice round numbers
          const msPerTick = totalDuration / baseDivisions;
          const msRoundingFactors = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
          tickInterval =
            msRoundingFactors.find(factor => factor >= msPerTick) || Math.ceil(msPerTick);
          break;
        case 'seconds':
          // For seconds, use intervals like 0.1s, 0.2s, 0.5s, 1s, 2s, 5s, 10s, etc.
          const secPerTick = totalDuration / 1000 / baseDivisions;
          const secRoundingFactors = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
          const secFactor =
            secRoundingFactors.find(factor => factor >= secPerTick) || Math.ceil(secPerTick);
          tickInterval = secFactor * 1000;
          break;
        case 'minutes':
          // For minutes, use intervals like 1min, 2min, 5min, 10min, 15min, 30min, 1h
          const minPerTick = totalDuration / 60000 / baseDivisions;
          const minRoundingFactors = [1, 2, 5, 10, 15, 30, 60];
          const minFactor =
            minRoundingFactors.find(factor => factor >= minPerTick) || Math.ceil(minPerTick);
          tickInterval = minFactor * 60000;
          break;
        case 'hours':
          // For hours, use intervals like 1h, 2h, 6h, 12h, 24h
          const hourPerTick = totalDuration / 3600000 / baseDivisions;
          const hourRoundingFactors = [1, 2, 3, 6, 12, 24];
          const hourFactor =
            hourRoundingFactors.find(factor => factor >= hourPerTick) || Math.ceil(hourPerTick);
          tickInterval = hourFactor * 3600000;
          break;
        default:
          tickInterval = 1000;
      }

      // Start before minTime and extend beyond maxTime, but align ticks to nice boundaries
      const startTime = minTime - totalDuration * 0.1;
      const endTime = maxTime + totalDuration * 0.3;

      // Align first tick to a nice boundary
      const firstTick = Math.floor(startTime / tickInterval) * tickInterval;

      for (let time = firstTick; time <= endTime; time += tickInterval) {
        if (time >= startTime) {
          ticks.push(time);
        }
      }

      // Ensure we have a reasonable number of ticks
      if (ticks.length > maxTicks) {
        // Take every nth tick to reduce count
        const step = Math.ceil(ticks.length / maxTicks);
        const filteredTicks = ticks.filter((_, index) => index % step === 0);
        return filteredTicks;
      }

      // If we have too few ticks, try to add more by reducing interval
      if (ticks.length < 4 && totalDuration > 0) {
        const newInterval = tickInterval / 2;
        const newTicks = [];
        for (let time = firstTick; time <= endTime; time += newInterval) {
          if (time >= startTime) {
            newTicks.push(time);
          }
        }
        return newTicks.slice(0, maxTicks);
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
                  const timeLabel = formatTime(time, minTime, timeScale);
                  const labelWidth_calc = timeLabel.length * 6 + 8; // Estimate label width
                  const labelX = Math.max(
                    labelWidth + labelWidth_calc / 2,
                    Math.min(x, chartWidth - labelWidth_calc / 2)
                  );

                  return (
                    <g key={index}>
                      {/* Grid line */}
                      <line
                        x1={x}
                        y1={0}
                        x2={x}
                        y2={totalHeight}
                        stroke={COLORS.grid}
                        strokeWidth={0.5}
                        opacity={0.6}
                      />
                      {/* Timeline tick mark */}
                      <line
                        x1={x}
                        y1={timelineHeight - 8}
                        x2={x}
                        y2={timelineHeight}
                        stroke={COLORS.border}
                        strokeWidth={2}
                        opacity={0.8}
                      />
                      {/* Label background */}
                      <rect
                        x={labelX - labelWidth_calc / 2}
                        y={6}
                        width={labelWidth_calc}
                        height={18}
                        fill={COLORS.surface}
                        stroke={COLORS.border}
                        strokeWidth={0.5}
                        rx={3}
                        opacity={0.95}
                      />
                      {/* Label text */}
                      <text
                        x={labelX}
                        y={18}
                        textAnchor="middle"
                        fontSize="10"
                        fill={COLORS.text}
                        fontWeight="600"
                      >
                        {timeLabel}
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
              const barHeight = Math.floor(currentRowHeight * 0.75); // 3/4 of container row
              const barPadding = (currentRowHeight - barHeight) / 2; // Center the bar vertically
              const indent = task.level * indentWidth;

              // Calculate appropriate font sizes based on bar height
              const labelFontSize = Math.max(8, Math.min(12, barHeight * 0.6));
              const durationFontSize = Math.max(6, Math.min(10, barHeight * 0.5));

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
                    y={y}
                    width={chartWidth}
                    height={currentRowHeight}
                    fill={
                      isSelected ? '#f0f9ff' : index % 2 === 0 ? COLORS.surface : COLORS.background
                    }
                    stroke="none"
                    strokeWidth={0}
                    opacity={isHovered ? 0.8 : 1}
                    style={{ transition: 'all 0.2s ease' }}
                  />

                  {/* Task Label with Tree Structure */}
                  <g>
                    {/* Tree expand/collapse icon */}
                    {isCollapsible && (
                      <text
                        x={indent + 15}
                        y={y + currentRowHeight / 2 + 4}
                        fontSize="12"
                        fill={taskColor}
                        textAnchor="middle"
                        dominantBaseline="central"
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
                          y1={y}
                          x2={indent}
                          y2={y + currentRowHeight / 2}
                          stroke={COLORS.border}
                          strokeWidth={1}
                        />
                      </g>
                    )}

                    {/* Task name */}
                    <text
                      x={indent + (isCollapsible ? 35 : 15)}
                      y={y + currentRowHeight / 2}
                      fontSize={isMain ? '14' : isMethod ? '12' : '11'}
                      fill={isMain ? COLORS.primary : COLORS.text}
                      textAnchor="start"
                      dominantBaseline="central"
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
                        x={indent + (isCollapsible ? 35 : 15)}
                        y={y + currentRowHeight / 2 + 8}
                        fontSize="8"
                        fill={COLORS.textLight}
                        textAnchor="start"
                        dominantBaseline="central"
                        fontWeight="400"
                      >
                        Called by: {task.callers.length} • Calls: {task.callees.length}
                      </text>
                    )}

                    {/* Duration info */}
                    {!isMethod && (
                      <text
                        x={indent + (isCollapsible ? 35 : 15)}
                        y={y + currentRowHeight / 2 + (task.callers.length > 0 ? 14 : 8)}
                        fontSize="8"
                        fill={COLORS.textLight}
                        textAnchor="start"
                        dominantBaseline="central"
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
                      y={y + barPadding + 2}
                      width={taskWidth}
                      height={barHeight}
                      fill="rgba(0,0,0,0.1)"
                    />

                    {/* Main bar */}
                    <rect
                      x={taskStartX}
                      y={y + barPadding}
                      width={taskWidth}
                      height={barHeight}
                      fill={`url(#${gradientId})`}
                      stroke={isHovered ? 'white' : taskColor}
                      strokeWidth={isHovered ? 3 : 1}
                      opacity={isHovered ? 0.9 : isMethod ? 0.8 : 0.85}
                      filter="url(#dropShadow)"
                      style={{ transition: 'all 0.2s ease' }}
                    />

                    {/* Running task indicator */}
                    {task.name.includes('🔄') && (
                      <rect
                        x={taskStartX + 2}
                        y={y + barPadding + 2}
                        width={taskWidth - 4}
                        height={barHeight - 4}
                        fill="rgba(255,255,255,0.2)"
                      />
                    )}

                    {/* Duration label on bar */}
                    {taskWidth > 30 && barHeight > 10 && (
                      <text
                        x={taskStartX + taskWidth / 2}
                        y={y + barPadding + barHeight / 2 + durationFontSize / 3}
                        textAnchor="middle"
                        fontSize={durationFontSize}
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
