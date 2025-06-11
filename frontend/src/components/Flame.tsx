import * as d3 from 'd3';
import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { GraphData, PhysicalViewData, FlameGraphData } from '../types';

type FlameVisualizationProps = {
  flameData: FlameGraphData;
  onElementClick: (data: any, skip_zoom?: boolean) => void;
  selectedElementId: string | null;
  flowId?: string;
  onUpdate?: () => void;
  updating?: boolean;
  searchTerm?: string;
  graphData: GraphData;
  physicalViewData?: PhysicalViewData | null;
  colorMode?:
    | 'warm'
    | 'cold'
    | 'red'
    | 'orange'
    | 'yellow'
    | 'green'
    | 'pastelgreen'
    | 'blue'
    | 'aqua'
    | 'allocation'
    | 'differential'
    | 'nodejs';
  currentTimestamp?: number;
};

type FlameNode = {
  name: string;
  customValue: number;
  totalInParent?: Array<{
    callerNodeId: string;
    duration: number;
    count: number;
    startTime: number;
    parentSpanId: string;
  }>;
  startTime?: number;
  originalValue?: number; // Store original value for display
  count?: number;
  children?: FlameNode[];
  hide?: boolean;
  fade?: boolean;
  highlight?: boolean;
  dimmed?: boolean; // Add dimmed property
  serviceName?: string;
  value?: number;
  delta?: number;
  isRunning?: boolean;
  extras?: {
    v8_jit?: boolean;
    javascript?: boolean;
    optimized?: number;
  };
};

// Extended type for D3 hierarchy node with partition layout properties
type PartitionHierarchyNode = d3.HierarchyNode<FlameNode> & {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  delta?: number;
  originalValue?: number;
  id?: string | number;
  customValue?: number; // Make sure this is defined as a mutable property
};

// Enhanced type for hierarchy building - export this type for use in other components
export type HierarchyNode = {
  name: string;
  customValue: number;
  totalInParent?: Array<{
    callerNodeId: string;
    duration: number;
    count: number;
    startTime: number;
    parentSpanId: string;
  }>;
  startTime?: number;
  originalValue?: number;
  count?: number;
  children?: HierarchyNode[];
  hide?: boolean;
  fade?: boolean;
  highlight?: boolean;
  dimmed?: boolean;
  serviceName?: string;
  value?: number;
  delta?: number;
  isRunning?: boolean;
  extras?: {
    v8_jit?: boolean;
    javascript?: boolean;
    optimized?: number;
  };
};

// Generate a hash value between 0 and 1 based on function name
const generateHash = (name: string): number => {
  const MAX_CHAR = 6;
  let hash = 0;
  let maxHash = 0;
  let weight = 1;
  const mod = 10;

  if (name) {
    for (let i = 0; i < Math.min(name.length, MAX_CHAR); i++) {
      hash += weight * (name.charCodeAt(i) % mod);
      maxHash += weight * (mod - 1);
      weight *= 0.7;
    }
    if (maxHash > 0) {
      hash = hash / maxHash;
    }
  }
  return hash;
};

// Generate a color vector based on the function name
const generateColorVector = (name: string): number => {
  let vector = 0;
  if (name) {
    const nameArr = name.split('`');
    if (nameArr.length > 1) {
      name = nameArr[nameArr.length - 1]; // drop module name if present
    }
    name = name.split('(')[0]; // drop extra info
    vector = generateHash(name);
  }
  return vector;
};

// Calculate color based on hue and vector
const calculateColor = (hue: string, vector: number): string => {
  let r: number;
  let g: number;
  let b: number;

  if (hue === 'red') {
    r = 200 + Math.round(55 * vector);
    g = 50 + Math.round(80 * vector);
    b = g;
  } else if (hue === 'orange') {
    r = 190 + Math.round(65 * vector);
    g = 90 + Math.round(65 * vector);
    b = 0;
  } else if (hue === 'yellow') {
    r = 175 + Math.round(55 * vector);
    g = r;
    b = 50 + Math.round(20 * vector);
  } else if (hue === 'green') {
    r = 50 + Math.round(60 * vector);
    g = 200 + Math.round(55 * vector);
    b = r;
  } else if (hue === 'pastelgreen') {
    r = 163 + Math.round(75 * vector);
    g = 195 + Math.round(49 * vector);
    b = 72 + Math.round(149 * vector);
  } else if (hue === 'blue') {
    r = 91 + Math.round(126 * vector);
    g = 156 + Math.round(76 * vector);
    b = 221 + Math.round(26 * vector);
  } else if (hue === 'aqua') {
    r = 50 + Math.round(60 * vector);
    g = 165 + Math.round(55 * vector);
    b = g;
  } else if (hue === 'cold') {
    r = 0 + Math.round(55 * (1 - vector));
    g = 0 + Math.round(230 * (1 - vector));
    b = 200 + Math.round(55 * vector);
  } else {
    // original warm palette
    r = 200 + Math.round(55 * vector);
    g = 0 + Math.round(230 * (1 - vector));
    b = 0 + Math.round(55 * (1 - vector));
  }

  return `rgb(${r},${g},${b})`;
};

// Helper function to interpolate between two colors
const pickHex = (color1: number[], color2: number[], weight: number): number[] => {
  const w1 = weight;
  const w2 = 1 - w1;
  return [
    Math.round(color1[0] * w1 + color2[0] * w2),
    Math.round(color1[1] * w1 + color2[1] * w2),
    Math.round(color1[2] * w1 + color2[2] * w2),
  ];
};

// Color mapper for allocation view
const allocationColorMapper = (d: PartitionHierarchyNode, originalColor: string): string => {
  if (d.data.highlight) {
    return originalColor;
  }

  const self = d.data.value || 0;
  const total = d.value || 0;
  const color = pickHex([0, 255, 40], [196, 245, 233], self / total);

  return `rgb(${color.join()})`;
};

// Color mapper for Node.js view
const nodeJsColorMapper = (d: PartitionHierarchyNode, originalColor: string): string => {
  let color = originalColor;

  const extras = (d.data as any).extras || {};
  const { v8_jit, javascript, optimized } = extras;

  // Non-JS JIT frames (V8 builtins) are greyed out
  if (v8_jit && !javascript) {
    color = '#dadada';
  }
  // JavaScript frames are colored based on optimization level
  if (javascript) {
    let opt = (optimized || 0) / (d.value || 1);
    let r = 255;
    let g = 0;
    let b = 0;
    if (opt < 0.4) {
      opt = opt * 2.5;
      r = 240 - opt * 200;
    } else if (opt < 0.9) {
      opt = (opt - 0.4) * 2;
      r = 0;
      b = 200 - 200 * opt;
      g = 100 * opt;
    } else {
      opt = (opt - 0.9) * 10;
      r = 0;
      b = 0;
      g = 100 + 150 * opt;
    }
    color = `rgb(${r},${g},${b})`;
  }
  return color;
};

// Color mapper for differential view
const differentialColorMapper = (d: PartitionHierarchyNode, originalColor: string): string => {
  if (d.data.highlight) {
    return originalColor;
  }

  let r = 220;
  let g = 220;
  let b = 220;

  const delta = d.delta || d.data.delta || 0;
  const unsignedDelta = Math.abs(delta);
  let value = d.value || d.data.value || 0;
  if (value <= unsignedDelta) {
    value = unsignedDelta;
  }
  const vector = unsignedDelta / value;

  if (delta === value) {
    // likely a new frame, color orange
    r = 255;
    g = 190;
    b = 90;
  } else if (delta > 0) {
    // an increase, color red
    b = Math.round(235 * (1 - vector));
    g = b;
  } else if (delta < 0) {
    // a decrease, color blue
    r = Math.round(235 * (1 - vector));
    g = r;
  }

  return `rgb(${r},${g},${b})`;
};

const colorMapper = (d: PartitionHierarchyNode, colorMode = 'warm') => {
  // Get the root node to find the max value
  const root = d.ancestors().pop() || d;
  const maxValue = root.value || 0;

  // Handle different color modes
  switch (colorMode) {
    case 'allocation':
      return allocationColorMapper(d, '#E600E6');
    case 'differential':
      return differentialColorMapper(d, '#E600E6');
    case 'nodejs':
      return nodeJsColorMapper(d, '#E600E6');
    case 'cold':
      const vector = generateColorVector(d.data.name);
      return calculateColor('cold', vector);
    default:
      // For all other modes (warm, red, orange, yellow, green, pastelgreen, blue, aqua)
      // Use the value-based approach with the specified color mode
      const value = d.value || 0;
      const normalizedValue = value / maxValue;
      return calculateColor(colorMode, normalizedValue);
  }
};

// Export the hierarchy building function for reuse in other components
export const buildCompleteHierarchy = (
  data: FlameGraphData,
  currentTimestamp: number = Date.now()
): HierarchyNode => {
  if (!data || !data.aggregated || !Array.isArray(data.aggregated)) {
    console.warn('Invalid flame graph data format:', data);
    return { name: '_root', customValue: 0, children: [] };
  }

  // Pre-process data to merge same caller id + span id combinations
  const aggregateData = (inputData: FlameGraphData): FlameGraphData => {
    const processedData = { ...inputData };

    // Process aggregated data - merge totalInParent entries with same callerNodeId + parentSpanId
    processedData.aggregated = inputData.aggregated.map(node => {
      if (!node.totalInParent || node.totalInParent.length === 0) {
        return node;
      }

      // Group by callerNodeId + parentSpanId
      const groupedEntries = new Map<string, (typeof node.totalInParent)[0]>();

      node.totalInParent.forEach(entry => {
        const key = `${entry.callerNodeId}@${entry.parentSpanId}`;
        const existing = groupedEntries.get(key);

        if (existing) {
          // Merge: earliest start time, sum duration and count
          groupedEntries.set(key, {
            callerNodeId: entry.callerNodeId,
            duration: existing.duration + entry.duration,
            count: existing.count + entry.count,
            startTime: Math.min(existing.startTime, entry.startTime),
            parentSpanId: entry.parentSpanId,
          });
        } else {
          groupedEntries.set(key, { ...entry });
        }
      });

      return {
        ...node,
        totalInParent: Array.from(groupedEntries.values()),
      };
    });

    // Process parentStartTimes - merge entries with same callerId + parentSpanId
    processedData.parentStartTimes = inputData.parentStartTimes.map(parentStartTime => {
      if (!parentStartTime.startTimes || parentStartTime.startTimes.length === 0) {
        return parentStartTime;
      }

      // Group by callerId + parentSpanId
      const groupedStartTimes = new Map<string, (typeof parentStartTime.startTimes)[0]>();

      parentStartTime.startTimes.forEach(startTimeEntry => {
        const key = `${startTimeEntry.callerId}@${startTimeEntry.parentSpanId}`;
        const existing = groupedStartTimes.get(key);

        if (existing) {
          // Merge: take earliest start time
          if (startTimeEntry.startTime < existing.startTime) {
            groupedStartTimes.set(key, { ...startTimeEntry });
          }
        } else {
          groupedStartTimes.set(key, { ...startTimeEntry });
        }
      });

      return {
        ...parentStartTime,
        startTimes: Array.from(groupedStartTimes.values()),
      };
    });

    return processedData;
  };

  // Apply data aggregation
  const aggregatedData = aggregateData(data);

  // Find max value for normalization
  let maxValue = 0;
  let minValue = Infinity;

  // First pass: calculate all original values including running processes
  const calculatedValues = new Map<string, number>();

  aggregatedData.aggregated.forEach(node => {
    let originalValue = node.value || 0;

    // For nodes with original value of 0, try to calculate from startTime if available
    if (originalValue === 0 && node.totalInParent && node.totalInParent.length > 0) {
      // Find the earliest startTime across all parents
      const earliestStartTime = Math.min(
        ...node.totalInParent.filter(entry => entry.startTime > 0).map(entry => entry.startTime)
      );

      if (earliestStartTime > 0 && isFinite(earliestStartTime)) {
        originalValue = currentTimestamp / 1000 - earliestStartTime;
      }
    }

    // Ensure all data points have at least a minimum value for visibility
    if (originalValue <= 0) {
      originalValue = 0.001; // Minimum visible value
    }

    calculatedValues.set(node.name, originalValue);

    if (originalValue > maxValue) {
      maxValue = originalValue;
    }
    if (originalValue < minValue) {
      minValue = originalValue;
    }
  });

  // If no positive values found, set reasonable defaults
  if (minValue === Infinity || maxValue === 0) {
    minValue = 0.001;
    maxValue = 1;
  }

  // Build complete hierarchy tree with proper span awareness
  const buildHierarchy = () => {
    // Create a comprehensive call relationship map
    const callRelations = new Map<
      string,
      Array<{
        childName: string;
        duration: number;
        count: number;
        startTime: number;
      }>
    >();

    // Create a map of all nodes from original data for quick lookup
    const originalNodeMap = new Map<string, any>();
    aggregatedData.aggregated.forEach(nodeData => {
      originalNodeMap.set(nodeData.name, nodeData);
    });

    // First, collect ALL parent-child relationships from the ORIGINAL aggregated data
    aggregatedData.aggregated.forEach(nodeData => {
      if (nodeData.totalInParent && nodeData.totalInParent.length > 0) {
        nodeData.totalInParent.forEach(
          ({ callerNodeId, duration, count, startTime, parentSpanId }) => {
            // Use callerNodeId@parentSpanId to distinguish different spans of the same function
            const parentKey = `${callerNodeId}@${parentSpanId}`;
            if (!callRelations.has(parentKey)) {
              callRelations.set(parentKey, []);
            }
            callRelations.get(parentKey)!.push({
              childName: nodeData.name,
              duration,
              count,
              startTime,
            });
          }
        );
      }
    });

    // Also collect running processes from parentStartTimes
    aggregatedData.parentStartTimes.forEach(({ calleeId, startTimes }) => {
      startTimes.forEach(({ callerId, startTime, parentSpanId }) => {
        // Use callerId@parentSpanId for running processes too
        const parentKey = `${callerId}@${parentSpanId}`;
        if (!callRelations.has(parentKey)) {
          callRelations.set(parentKey, []);
        }

        let originalValue = 0;
        if (startTime > 0) {
          originalValue = currentTimestamp / 1000 - startTime;
        }
        if (originalValue <= 0) {
          originalValue = 0.001;
        }

        callRelations.get(parentKey)!.push({
          childName: calleeId,
          duration: originalValue,
          count: 1,
          startTime,
        });
      });
    });

    // Recursive function to build a complete subtree for any span-aware node key
    const buildSubtree = (
      nodeKey: string,
      visited: Set<string> = new Set(),
      specificTiming?: { duration: number; count: number; startTime: number }
    ): HierarchyNode => {
      if (visited.has(nodeKey)) {
        // Return a minimal node to prevent infinite recursion
        return {
          name: nodeKey,
          customValue: 0.001,
          originalValue: 0.001,
          children: [],
          hide: false,
          fade: false,
          highlight: false,
          dimmed: false,
        };
      }

      visited.add(nodeKey);

      // Extract the base node name (without span ID) for data lookup
      const baseName = nodeKey.includes('@')
        ? nodeKey.substring(0, nodeKey.lastIndexOf('@'))
        : nodeKey;

      const children: HierarchyNode[] = [];

      // Get child relations for this specific span-aware node key
      const childRelations = callRelations.get(nodeKey) || [];

      // Process each child relationship - create separate child for each call
      childRelations.forEach(({ childName, duration, count, startTime }, childIndex) => {
        // Get child data from original aggregated data using the actual child name
        const originalChildData = originalNodeMap.get(childName);

        // For span-aware children, try to find a span key that makes sense in this context
        let childSpanKey = childName; // Default fallback

        // Look for span-aware keys for this child
        const potentialSpanKeys: string[] = [];
        for (const [relationKey] of callRelations) {
          if (relationKey.startsWith(`${childName}@`)) {
            potentialSpanKeys.push(relationKey);
          }
        }

        if (potentialSpanKeys.length > 0) {
          // Use the parent context and timing to create a deterministic but distributed selection
          const parentContext = `${nodeKey}-${duration}-${count}-${startTime}`;
          const contextHash = parentContext.split('').reduce((a, b) => {
            a = (a << 5) - a + b.charCodeAt(0);
            return a & a;
          }, 0);

          // Use the hash to distribute span selection across available options
          const selectedIndex = Math.abs(contextHash) % potentialSpanKeys.length;
          childSpanKey = potentialSpanKeys[selectedIndex];
        } else {
          // If no span-aware key exists, create a context-specific key for timing inheritance
          childSpanKey = `${childName}@${nodeKey.split('@')[1] || 'context'}`;
        }

        // Create a unique visited set to prevent sharing between different parent contexts
        const uniqueVisited = new Set(visited);
        uniqueVisited.add(`${nodeKey}->${childName}#${childIndex}`);

        // Recursively build the child's subtree using the span-aware key
        const childSubtree = buildSubtree(childSpanKey, uniqueVisited, {
          duration,
          count,
          startTime,
        });

        // Ensure the child has a clean display name (without span suffixes)
        if (childSubtree.name.includes('@')) {
          childSubtree.name = childSubtree.name.substring(0, childSubtree.name.lastIndexOf('@'));
        }

        // Set additional metadata from original data, but preserve the timing values we just set
        if (originalChildData) {
          childSubtree.serviceName = originalChildData.serviceName;
          childSubtree.value = originalChildData.value;
          childSubtree.delta = originalChildData.delta;
          childSubtree.extras = originalChildData.extras;
          childSubtree.isRunning = false;
        } else {
          // This is a running process
          childSubtree.isRunning = true;
        }

        children.push(childSubtree);
      });

      // Get base data for current node using base name
      const originalNodeData = originalNodeMap.get(baseName);
      let baseCustomValue = 0.001;
      let baseOriginalValue = 0.001;
      let baseCount = 1;
      let baseStartTime: number | undefined;

      // If we have specific timing from parent relationship, use that instead of global data
      if (specificTiming) {
        baseOriginalValue = specificTiming.duration;
        baseCount = specificTiming.count;
        baseStartTime = specificTiming.startTime;

        // Calculate normalized value for sizing
        let normalizedValue = specificTiming.duration;
        if (maxValue > minValue && maxValue > 0) {
          if (maxValue / minValue > 100) {
            const scalingFactor = Math.sqrt(specificTiming.duration / maxValue);
            normalizedValue = scalingFactor * maxValue;
            if (normalizedValue < maxValue * 0.01) {
              normalizedValue = maxValue * 0.01;
            }
          } else {
            normalizedValue = specificTiming.duration;
          }
        }
        if (normalizedValue <= 0) {
          normalizedValue = Math.max(maxValue * 0.001, 0.001);
        }
        baseCustomValue = normalizedValue;
      } else if (originalNodeData) {
        const originalValue = calculatedValues.get(baseName) || 0.001;

        // Calculate normalized value for sizing
        let normalizedValue = originalValue;
        if (maxValue > minValue && maxValue > 0) {
          if (maxValue / minValue > 100) {
            const scalingFactor = Math.sqrt(originalValue / maxValue);
            normalizedValue = scalingFactor * maxValue;
            if (normalizedValue < maxValue * 0.01) {
              normalizedValue = maxValue * 0.01;
            }
          } else {
            normalizedValue = originalValue;
          }
        }
        if (normalizedValue <= 0) {
          normalizedValue = Math.max(maxValue * 0.001, 0.001);
        }

        baseCustomValue = normalizedValue;
        baseOriginalValue = originalValue;
        baseCount = originalNodeData.count || 1;
        baseStartTime = originalNodeData.startTime;
      } else if (baseName === '_main') {
        // For main node, calculate total from children
        baseCustomValue =
          children.reduce((sum, child) => sum + (child.customValue || 0), 0) || 0.001;
        baseOriginalValue = baseCustomValue;
      }

      return {
        name: baseName, // Use base name for display (without span ID)
        customValue: baseCustomValue,
        originalValue: baseOriginalValue,
        count: baseCount,
        startTime: baseStartTime,
        children: children,
        serviceName: originalNodeData?.serviceName || (baseName === '_main' ? '_main' : undefined),
        hide: false,
        fade: false,
        highlight: false,
        dimmed: false,
        value: originalNodeData?.value,
        delta: originalNodeData?.delta,
        totalInParent: originalNodeData?.totalInParent || [],
        isRunning: originalNodeData?.isRunning || false,
        extras: originalNodeData?.extras,
      };
    };

    // Find all _main span variations and build separate trees for each
    const mainSpans: string[] = [];
    for (const [parentKey] of callRelations) {
      if (parentKey.startsWith('_main@')) {
        mainSpans.push(parentKey);
      }
    }

    if (mainSpans.length === 0) {
      // Fallback: create a minimal main node
      return {
        name: '_main',
        customValue: 0.001,
        originalValue: 0.001,
        children: [],
        hide: false,
        fade: false,
        highlight: false,
        dimmed: false,
      };
    }

    // If there's only one main span, build its tree directly
    if (mainSpans.length === 1) {
      return buildSubtree(mainSpans[0]);
    }

    // If there are multiple main spans, create a root main node with all span trees as children
    const spanChildren: HierarchyNode[] = [];
    let totalValue = 0;

    mainSpans.forEach(spanKey => {
      const spanTree = buildSubtree(spanKey);
      spanChildren.push(spanTree);
      totalValue += spanTree.customValue || 0;
    });

    return {
      name: '_main',
      customValue: Math.max(totalValue, 0.001),
      originalValue: Math.max(totalValue, 0.001),
      children: spanChildren,
      serviceName: '_main',
      hide: false,
      fade: false,
      highlight: false,
      dimmed: false,
      totalInParent: [],
      isRunning: false,
    };
  };

  // Build the complete hierarchy with all nested relationships
  const finalMainNode = buildHierarchy();

  // Calculate total value of all children
  let totalChildrenValue = 0;
  if (finalMainNode.children) {
    finalMainNode.children.forEach(child => {
      totalChildrenValue += child.customValue || 0;
    });
  }

  // Ensure the main node has a proper value based on its children
  finalMainNode.customValue = Math.max(totalChildrenValue, 0.001);
  finalMainNode.originalValue = Math.max(totalChildrenValue, 0.001);

  // IMPORTANT: Make sure no nodes are hidden by default
  const ensureNodesVisible = (node: HierarchyNode) => {
    // Remove hide and fade properties or set them to false
    node.hide = false;
    node.fade = false;

    // Recursively process children
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => ensureNodesVisible(child));
    }
  };

  // Apply the fix to make all nodes visible
  ensureNodesVisible(finalMainNode);

  return finalMainNode;
};

// Define handle type for ExportSvg
export type FlameVisualizationHandle = {
  exportSvg: () => void;
};

const FlameVisualization = forwardRef<FlameVisualizationHandle, FlameVisualizationProps>(
  (
    {
      flameData,
      onElementClick,
      searchTerm,
      graphData,
      physicalViewData,
      colorMode = 'warm',
      currentTimestamp = Date.now(),
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const detailsRef = useRef<HTMLDivElement | null>(null);
    const flameChartRef = useRef<any>(null);
    const chartRef = useRef<any>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);

    const generatePathId = (node: d3.HierarchyNode<FlameNode>): string => {
      const path: string[] = [];
      let current: typeof node | null = node;
      while (current) {
        path.unshift(current.data.name);
        current = current.parent;
      }
      return path.join('->');
    };

    // Wrap createFlameGraph in useCallback
    const createFlameGraph = () => {
      let width = containerRef.current ? containerRef.current.clientWidth : 960; // graph width
      let height: number | null = null; // graph height
      let cellHeight = 18; // cell height
      let selection: any = null; // selection
      let tooltip: any = null; // tooltip
      let title = ''; // graph title
      let sort: boolean | ((a: PartitionHierarchyNode, b: PartitionHierarchyNode) => number) =
        false;
      let inverted = false; // invert the graph direction
      let clickHandler: ((d: PartitionHierarchyNode) => void) | null = null;
      let hoverHandler: ((d: PartitionHierarchyNode) => void) | null = null;
      let minFrameSize = 0;
      let detailsElement: HTMLElement | null = null;
      let selfValue = false;
      let resetHeightOnZoom = false;
      let minHeight: number | null = null;

      // Store the initial coordinates hierarchy
      type NodeCoords = {
        x0: number;
        x1: number;
        fade: boolean;
        hide: boolean;
        delta: number;
        originalValue: number;
        customValue: number;
        children?: NodeCoords[];
      };

      let nodeHierarchy: NodeCoords | null = null;

      const storeInitialCoords = (node: PartitionHierarchyNode): NodeCoords => {
        const coords: NodeCoords = {
          x0: node.x0,
          x1: node.x1,
          fade: node.data.fade || false,
          hide: node.data.hide || false,
          delta: node.delta || 0,
          originalValue: node.data.originalValue || 0,
          customValue: node.data.customValue || 0,
          children: [],
        };

        if (node.children) {
          coords.children = node.children.map(child =>
            storeInitialCoords(child as PartitionHierarchyNode)
          );
        }

        return coords;
      };

      const resetNodes = (node: PartitionHierarchyNode, coords: NodeCoords) => {
        // Reset node properties
        node.data.hide = coords.hide;
        node.data.fade = coords.fade;
        node.delta = coords.delta;
        node.data.originalValue = coords.originalValue;
        node.data.customValue = coords.customValue;
        // Restore coordinates
        node.x0 = coords.x0;
        node.x1 = coords.x1;

        // Recursively reset children
        if (node.children && coords.children) {
          for (let i = 0; i < node.children.length; i++) {
            resetNodes(node.children[i] as PartitionHierarchyNode, coords.children[i]);
          }
        }
      };

      const getName = (d: PartitionHierarchyNode) => {
        let name = d.data.name;
        if (!name) {
          return '';
        }
        if (name === '_main') {
          return 'main';
        }

        // If node has children, remove last @ and everything after it
        if (d.children && d.children.length > 0) {
          const lastAtIndex = name.lastIndexOf('@');
          if (lastAtIndex !== -1) {
            name = name.substring(0, lastAtIndex);
          }
        }

        // Check if the name follows the expected format: service_name:instance_id.func
        const match = name.match(/^(.+?):(.+?)\.(.+)$/);
        if (match) {
          const [_, serviceName, _1, func] = match; // eslint-disable-line
          return `${serviceName}.${func}`;
        }

        // If the name doesn't match the expected format, return it as is
        return name;
      };

      const getValue = (d: PartitionHierarchyNode) => {
        // Return the normalized value for sizing
        return d.customValue !== undefined ? d.customValue : d.value || 0;
      };

      const getChildren = (d: FlameNode) => {
        return d.children;
      };

      const colorMapperWrapper = (d: PartitionHierarchyNode) => {
        return colorMapper(d, colorMode);
      };

      const hideSiblings = (node: PartitionHierarchyNode) => {
        let child = node;
        let parent = child.parent as PartitionHierarchyNode;

        // First, show the path to the selected node and hide its siblings
        while (parent) {
          parent.data.hide = false; // Ensure the ancestor path is visible
          // eslint-disable-next-line
          parent.children?.forEach(sibling => {
            if (sibling !== child) {
              (sibling as PartitionHierarchyNode).data.hide = true;
              // Hide all descendants of hidden siblings
              hideDescendants(sibling as PartitionHierarchyNode);
            }
          });

          child = parent;
          parent = parent.parent as PartitionHierarchyNode;
        }

        // Show the selected node and its descendants
        node.data.hide = false;
        if (node.children) {
          node.children.forEach(child => {
            (child as PartitionHierarchyNode).data.hide = false;
          });
        }
      };

      const hideDescendants = (node: PartitionHierarchyNode) => {
        node.data.hide = true;
        if (node.children) {
          for (let i = 0; i < node.children.length; i++) {
            hideDescendants(node.children[i] as PartitionHierarchyNode);
          }
        }
      };

      const fadeAncestors = (d: PartitionHierarchyNode) => {
        if (d.parent) {
          (d.parent as PartitionHierarchyNode).data.fade = true;
          fadeAncestors(d.parent as PartitionHierarchyNode);
        }
      };

      const zoom = (d: PartitionHierarchyNode) => {
        // Get the root node
        const root = d.ancestors().pop() || d;

        // Get the current container width
        if (containerRef.current) {
          width = containerRef.current.clientWidth;
        }

        // Reset all nodes to their initial state
        if (nodeHierarchy && d.data.fade === true) {
          resetNodes(root, nodeHierarchy);
          update();
        }
        if (d.data.name === '_main') {
          return;
        }

        // Calculate the scale factor based on root width vs node width
        const scaleFactor = (root.x1 - root.x0) / (d.x1 - d.x0);

        // Hide siblings and fade ancestors
        hideSiblings(d);
        fadeAncestors(d);

        // Extend all parent nodes to root.x1
        let current = d;
        while (current.parent) {
          current.parent.x1 = root.x1;
          current.parent.x0 = root.x0;
          current = current.parent;
        }

        // Scale the node and its descendants
        const scaleSubtree = (node: PartitionHierarchyNode, baseX0: number, baseX1: number) => {
          // For the root node of subtree, use the exact base coordinates
          node.x0 = baseX0;
          node.x1 = baseX1;

          // Handle children sequentially if they exist
          if (node.children && node.children.length > 0) {
            let currentX = node.x0; // Start from parent's x0
            // eslint-disable-next-line
            node.children.forEach((child, index) => {
              const childNode = child as PartitionHierarchyNode;
              const childWidth = (childNode.x1 - childNode.x0) * scaleFactor;

              // Set child coordinates
              childNode.x0 = currentX;
              childNode.x1 = currentX + childWidth;

              // Update currentX for next child
              currentX = childNode.x1;

              // Recursively handle this child's children
              if (childNode.children) {
                scaleSubtree(childNode, childNode.x0, childNode.x1);
              }
            });
          }
        };

        // Scale the selected node and its subtree to fill the root width
        scaleSubtree(d, root.x0, root.x1);

        update();
        if (typeof clickHandler === 'function') {
          clickHandler(d);
        }
      };

      const searchMatch = (d: PartitionHierarchyNode, term: string, ignoreCase = false) => {
        if (!term) {
          return false;
        }
        let label = getName(d);
        if (ignoreCase) {
          term = term.toLowerCase();
          label = label.toLowerCase();
        }
        return typeof label !== 'undefined' && label && label.includes(term);
      };

      const searchTree = (d: PartitionHierarchyNode, term: string) => {
        const results: PartitionHierarchyNode[] = [];
        let sum = 0;
        const matchingPaths = new Set<string>();

        // First pass to find all matching nodes and their paths
        const findMatches = (node: PartitionHierarchyNode, path: string[] = []) => {
          const currentPath = [...path, node.data.name];
          const pathKey = currentPath.join('->');

          const isMatch = searchMatch(node, term);
          if (isMatch) {
            matchingPaths.add(pathKey);
            results.push(node);
            if (!node.parent) {
              sum += getValue(node);
            }

            // Add all parent paths to the matching paths
            for (let i = 1; i < currentPath.length; i++) {
              matchingPaths.add(currentPath.slice(0, i).join('->'));
            }
          }

          if (node.children) {
            node.children.forEach(child => {
              findMatches(child as PartitionHierarchyNode, currentPath);
            });
          }
        };

        // Second pass to hide or show nodes based on matching paths
        const applyVisibility = (node: PartitionHierarchyNode, path: string[] = []) => {
          const currentPath = [...path, node.data.name];
          const pathKey = currentPath.join('->');

          // Clear previous highlighting/dimming
          node.data.highlight = false;
          node.data.dimmed = false;

          // Hide node if it's not in a matching path
          node.data.hide = !matchingPaths.has(pathKey);

          if (node.children) {
            node.children.forEach(child => {
              applyVisibility(child as PartitionHierarchyNode, currentPath);
            });
          }
        };

        // Run the passes
        findMatches(d);
        applyVisibility(d);

        return [results, sum];
      };

      const clear = (d: PartitionHierarchyNode) => {
        d.data.highlight = false;
        d.data.dimmed = false;
        d.data.hide = false; // Make sure to unhide all nodes when clearing
        if (d.children) {
          d.children.forEach(child => {
            clear(child as PartitionHierarchyNode);
          });
        }
      };

      const doSort = (a: PartitionHierarchyNode, b: PartitionHierarchyNode) => {
        if (typeof sort === 'function') {
          return sort(a, b);
        } else if (sort) {
          return d3.ascending(getName(a), getName(b));
        }
        return 0;
      };

      const partition = d3
        .partition<FlameNode>()
        .size([width, 0]) // Initialize with current width, height will be set during update
        .padding(0)
        .round(false);

      const filterNodes = (root: PartitionHierarchyNode) => {
        // Filter out nodes that are marked as hidden
        return root.descendants().filter(node => !node.data.hide);
      };

      const reappraiseNode = (root: PartitionHierarchyNode) => {
        let node, children, grandChildren, childrenValue, i, j, child, childValue;
        const stack: PartitionHierarchyNode[] = [];
        const included: PartitionHierarchyNode[][] = [];
        const excluded: PartitionHierarchyNode[][] = [];
        const compoundValue = !selfValue;
        let item = root.data;

        if (item.hide) {
          root.customValue = 0;
          children = root.children;
          if (children) {
            excluded.push(children as PartitionHierarchyNode[]);
          }
        } else {
          root.customValue = item.fade ? 0 : getValue(root);
          stack.push(root);
        }

        // First DFS pass
        while ((node = stack.pop())) {
          children = node.children as PartitionHierarchyNode[];
          if (children && (i = children.length)) {
            childrenValue = 0;
            while (i--) {
              child = children[i];
              item = child.data;
              if (item.hide) {
                child.customValue = 0;
                grandChildren = child.children as PartitionHierarchyNode[];
                if (grandChildren) {
                  excluded.push(grandChildren);
                }
                continue;
              }
              if (item.fade) {
                child.customValue = 0;
              } else {
                childValue = getValue(child);
                child.customValue = childValue;
                childrenValue += childValue;
              }
              stack.push(child);
            }
            if (compoundValue && node.customValue) {
              node.customValue -= childrenValue;
            }
            included.push(children);
          }
        }

        // Postorder traversal
        i = included.length;
        while (i--) {
          children = included[i];
          childrenValue = 0;
          j = children.length;
          while (j--) {
            childrenValue += children[j].customValue || 0;
          }
          if (children[0] && children[0].parent) {
            (children[0].parent as PartitionHierarchyNode).customValue =
              ((children[0].parent as PartitionHierarchyNode).customValue || 0) + childrenValue;
          }
        }

        // Continue DFS for hidden nodes
        while (excluded.length > 0) {
          const nextChildren = excluded.pop();
          if (!nextChildren) {
            continue;
          }
          children = nextChildren;
          j = children.length;
          while (j--) {
            child = children[j];
            child.customValue = 0;
            grandChildren = child.children as PartitionHierarchyNode[];
            if (grandChildren) {
              excluded.push(grandChildren);
            }
          }
        }
      };

      const update = () => {
        selection.each(function (this: Element, root: PartitionHierarchyNode) {
          // Create proper scales with domains
          reappraiseNode(root);

          if (sort) {
            root.sort(doSort);
          }

          // Store current coordinates before partition layout
          const nodeMap = new Map<string, { x0: number; x1: number }>();
          root.descendants().forEach(d => {
            if (d.x0 !== undefined && d.x1 !== undefined) {
              const pathId = generatePathId(d);
              (d as any).pathId = pathId;
              nodeMap.set(pathId, { x0: d.x0, x1: d.x1 });
            }
          });

          // Get the current container width
          if (containerRef.current) {
            width = containerRef.current.clientWidth;
          }

          // Configure partition layout with correct dimensions
          const maxDepth = d3.max(root.descendants(), d => d.depth) || 0;
          const totalHeight = (maxDepth + 1) * cellHeight;

          // Apply partition layout only if coordinates haven't been set
          if (root.x0 === undefined || root.x1 === undefined) {
            partition.size([width, totalHeight])(root);
          }

          // Restore scaled coordinates
          root.descendants().forEach(d => {
            const pathId = generatePathId(d);
            const stored = nodeMap.get(pathId);
            if (stored) {
              d.x0 = stored.x0;
              d.x1 = stored.x1;
            }
          });

          let maxX = 0;
          root.children?.forEach(d => {
            if (d.x1 > maxX) {
              maxX = d.x1;
            }
          });
          root.x1 = maxX;

          // Calculate width based on the node's proportion of the total width
          const frameWidth = (d: PartitionHierarchyNode) => {
            return d.x1 - d.x0;
          };

          const descendants = filterNodes(root);

          // Ensure all descendants have pathId
          descendants.forEach(d => {
            if (!(d as any).pathId) {
              (d as any).pathId = generatePathId(d);
            }
          });

          const svg = d3.select(this).select('svg');
          svg.attr('width', width);

          let g = svg
            .selectAll<SVGGElement, PartitionHierarchyNode>('g')
            .data(descendants, d => generatePathId(d));

          // Set height on first update
          if (!height || resetHeightOnZoom) {
            height = totalHeight + cellHeight; // Add some padding
            if (minHeight && height < minHeight) {
              height = minHeight;
            }
            svg.attr('height', height);
          }

          // Create a proper y scale for vertical positioning
          const yScale = d3
            .scaleLinear()
            .domain([0, maxDepth])
            .range([0, (height || totalHeight) - cellHeight]);

          // Calculate the maximum time span for scaling
          g.attr(
            'transform',
            d =>
              `translate(${d.x0},${
                inverted ? yScale(d.depth) : (height || totalHeight) - yScale(d.depth) - cellHeight
              })`
          );

          g.select('rect').attr('width', frameWidth);

          // Enter new nodes with correct positioning
          const node = g
            .enter()
            .append('svg:g')
            .attr(
              'transform',
              d =>
                `translate(${d.x0},${
                  inverted
                    ? yScale(d.depth)
                    : (height || totalHeight) - yScale(d.depth) - cellHeight
                })`
            );

          node
            .append('svg:rect')
            .attr('width', frameWidth)
            .attr('height', cellHeight)
            .attr('fill', colorMapperWrapper);

          if (!tooltip) {
            node.append('svg:title');
          }

          node
            .append('foreignObject')
            .attr('width', frameWidth)
            .attr('height', cellHeight)
            .append('xhtml:div')
            .attr('class', 'd3-flame-graph-label')
            .style('display', 'block')
            .text(getName);
          // Re-select to see the new elements
          g = svg
            .selectAll<SVGGElement, PartitionHierarchyNode>('g')
            .data(descendants, d => generatePathId(d));

          g.attr('width', frameWidth)
            .attr('height', cellHeight)
            .attr('name', getName)
            .attr('class', d => {
              if (d.data.highlight) {
                return 'highlight';
              }
              if (d.data.dimmed) {
                return 'dimmed';
              }
              return '';
            });

          g.select('rect')
            .attr('height', cellHeight)
            .attr('fill', colorMapperWrapper)
            .attr('class', d => {
              if (d.data.highlight) {
                return 'highlight';
              }
              if (d.data.dimmed) {
                return 'dimmed';
              }
              return '';
            });

          g.select('foreignObject')
            .attr('width', frameWidth)
            .attr('height', cellHeight)
            .select('div')
            .attr('class', 'd3-flame-graph-label')
            .style('display', 'block')
            .text(getName);

          g.on('click', (event, d) => {
            event.stopPropagation();
            zoom(d);
          });

          g.exit().remove();

          g.on('mouseover', (event, d) => {
            if (tooltip) {
              tooltip.show(d, this);
            }
            if (typeof hoverHandler === 'function') {
              hoverHandler(d);
            }
          }).on('mouseout', () => {
            if (tooltip) {
              tooltip.hide();
            }
            if (detailsElement) {
              detailsElement.textContent = '';
            }
          });
        });
      };

      const processData = () => {
        selection.datum((data: FlameNode) => {
          const root = d3
            .hierarchy(data, getChildren)
            .sum(d => (d.customValue !== undefined ? d.customValue : 0));

          // Generate path-based IDs for all nodes
          root.descendants().forEach(node => {
            (node as any).pathId = generatePathId(node);
          });

          // Store initial coordinates after hierarchy is created
          nodeHierarchy = storeInitialCoords(root as PartitionHierarchyNode);

          return root as PartitionHierarchyNode;
        });
      };

      // eslint-disable-next-line
      function chart(s: any) {
        if (!arguments.length) {
          return chart;
        }

        // Saving the selection
        selection = s;

        // Processing raw data
        processData();

        // Create chart svg
        selection.each(function (this: Element) {
          // eslint-disable-line
          if (d3.select(this).select('svg').size() === 0) {
            const svg = d3
              .select(this)
              .append('svg:svg')
              .attr('width', width)
              .attr('class', 'partition d3-flame-graph')
              .style('margin', '0')
              .style('display', 'block');

            if (height) {
              if (minHeight && height < minHeight) {
                height = minHeight;
              }
              svg.attr('height', height);
            }

            svg
              .append('svg:text')
              .attr('class', 'title')
              .attr('text-anchor', 'start')
              .attr('y', '25')
              .attr('x', '20')
              .attr('fill', '#808080')
              .text(title);

            // Only call tooltip if it's a function
            if (tooltip && typeof tooltip === 'function') {
              svg.call(tooltip);
            }
          }
        });

        // First draw
        update();

        return chart as any;
      }

      // Chart configuration methods
      // eslint-disable-next-line
      chart.width = function (_: number) {
        if (!arguments.length) {
          return width;
        }
        width = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.height = function (_: number | null) {
        if (!arguments.length) {
          return height;
        }
        height = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.minHeight = function (_: number | null) {
        if (!arguments.length) {
          return minHeight;
        }
        minHeight = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.cellHeight = function (_: number) {
        if (!arguments.length) {
          return cellHeight;
        }
        cellHeight = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.tooltip = function (_: any) {
        if (!arguments.length) {
          return tooltip;
        }
        tooltip = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.title = function (_: string) {
        if (!arguments.length) {
          return title;
        }
        title = _;
        return chart;
      };

      // eslint-disable-next-line
      // eslint-disable-next-line
      chart.sort = function (
        _: boolean | ((a: PartitionHierarchyNode, b: PartitionHierarchyNode) => number)
      ) {
        if (!arguments.length) {
          return sort;
        }
        sort = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.inverted = function (_: boolean) {
        if (!arguments.length) {
          return inverted;
        }
        inverted = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.minFrameSize = function (_: number) {
        if (!arguments.length) {
          return minFrameSize;
        }
        minFrameSize = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.setDetailsElement = function (_: HTMLElement | null) {
        if (!arguments.length) {
          return detailsElement;
        }
        detailsElement = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.selfValue = function (_: boolean) {
        if (!arguments.length) {
          return selfValue;
        }
        selfValue = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.resetHeightOnZoom = function (_: boolean) {
        if (!arguments.length) {
          return resetHeightOnZoom;
        }
        resetHeightOnZoom = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.onClick = function (_: ((d: PartitionHierarchyNode) => void) | null) {
        if (!arguments.length) {
          return clickHandler;
        }
        clickHandler = _;
        return chart;
      };

      // eslint-disable-next-line
      chart.onHover = function (_: ((d: PartitionHierarchyNode) => void) | null) {
        if (!arguments.length) {
          return hoverHandler;
        }
        hoverHandler = _;
        return chart;
      };

      chart.search = (term: string) => {
        if (!selection) {
          return;
        }

        // If search term is empty, clear the search
        if (!term || term.trim() === '') {
          chart.clear();
          return;
        }

        // Reset zoom state before searching
        selection.each((root: PartitionHierarchyNode) => {
          // Restore all nodes to their initial state before searching
          if (nodeHierarchy) {
            resetNodes(root, nodeHierarchy);
          }

          // Now perform the search on the reset state
          searchTree(root, term);
        });

        update();
      };

      chart.clear = () => {
        if (!selection) {
          return;
        }

        if (detailsElement) {
          detailsElement.textContent = '';
        }

        selection.each((root: PartitionHierarchyNode) => {
          // Reset to initial state if available
          if (nodeHierarchy) {
            resetNodes(root, nodeHierarchy);
          }
          clear(root);
        });

        update();
      };

      chart.zoomTo = (d: PartitionHierarchyNode) => {
        zoom(d);
      };

      chart.resetZoom = () => {
        if (!selection) {
          return;
        }

        selection.each((root: PartitionHierarchyNode) => {
          zoom(root); // zoom to root
        });
      };

      chart.destroy = () => {
        if (!selection) {
          return chart;
        }

        if (tooltip && typeof tooltip.hide === 'function') {
          tooltip.hide();
        }

        selection.selectAll('svg').remove();
        return chart;
      };

      // Add this helper function at the top level of createFlameGraph
      return chart as any;
    };

    useEffect(() => {
      const container = containerRef.current;
      if (!container || !flameData) {
        return;
      }

      // Clear previous visualization
      d3.select(container).selectAll('*').remove();

      // Create container elements
      const d3Container = d3.select(container);

      // Create details element
      const detailsElement = d3Container
        .append('div')
        .attr('class', 'flame-details')
        .style('padding', '5px')
        .style('font-family', 'Verdana')
        .style('font-size', '12px');

      detailsRef.current = detailsElement.node() as HTMLDivElement;

      // Create tooltip
      const tooltip = d3Container
        .append('div')
        .attr('class', 'd3-flame-graph-tip')
        .style('position', 'fixed')
        .style('visibility', 'hidden')
        .style('pointer-events', 'none')
        .style('z-index', '100000')
        .style('background', 'rgba(0, 0, 0, 0.8)')
        .style('color', 'white')
        .style('padding', '8px')
        .style('border-radius', '4px')
        .style('font-size', '12px')
        .style('max-width', '300px')
        .style('word-wrap', 'break-word');

      tooltipRef.current = tooltip.node() as HTMLDivElement;

      // Create SVG with a group for zoom behavior
      const svg = d3Container
        .append('svg')
        .attr('class', 'partition d3-flame-graph')
        .style('margin', '0')
        .style('display', 'block');

      svgRef.current = svg.node() as SVGSVGElement;
      // Transform data
      const transformedData = transformFlameData(flameData);

      // Create flame graph
      const chart = createFlameGraph();
      flameChartRef.current = chart;

      // Configure chart
      chart
        .width(container.offsetWidth)
        .cellHeight(18)
        .minFrameSize(1)
        .inverted(false)
        .onClick((d: PartitionHierarchyNode) => {
          // Extract function/method name and actor information
          const nodeName = d.data.name;

          // Check if the name follows the expected format: actor_class:actor_id.func
          const match = nodeName.match(/^(.+?):(.+?)\.(.+)$/);

          if (match) {
            // This is an actor method
            const [_, serviceName, instanceId, funcName] = match; // eslint-disable-line

            // Try to find the service in physicalViewData if available
            let serviceGpuDevices: any[] = [];

            if (physicalViewData && physicalViewData.physicalView) {
              // Look through all nodes in physicalViewData
              // eslint-disable-next-line
              for (const [_, nodeData] of Object.entries(physicalViewData.physicalView)) {
                if (nodeData.services && nodeData.services[instanceId]) {
                  const physicalService = nodeData.services[instanceId];
                  // Use type assertion to access potential extended properties
                  const extendedService = physicalService as any;
                  // If the service has gpuDevices directly
                  if (extendedService.gpuDevices && Array.isArray(extendedService.gpuDevices)) {
                    serviceGpuDevices = extendedService.gpuDevices;
                  }
                }
              }
            }

            if (graphData) {
              const method = graphData.methods.find(
                m => m.name === funcName && m.instanceId === instanceId
              );

              if (method) {
                // If we found the function in graphData, use that data
                onElementClick(
                  {
                    id: method.id,
                    type: 'method',
                    name: method.name,
                    gpuDevices: serviceGpuDevices,
                    data: {
                      ...d.data,
                      duration: d.data.originalValue,
                      count: d.data.count,
                    },
                    serviceName: serviceName,
                  },
                  true
                );
                return;
              }
            }

            onElementClick(
              {
                id: instanceId,
                type: 'method',
                name: funcName,
                instanceId: instanceId,
                gpuDevices: serviceGpuDevices,
                data: {
                  ...d.data,
                  duration: d.data.originalValue,
                  count: d.data.count,
                },
              },
              true
            );
          } else {
            // This is a regular function
            if (graphData) {
              const func = graphData.functions.find(f => f.name === nodeName);

              if (func) {
                // If we found the function in graphData, use that data
                onElementClick(
                  {
                    id: func.id,
                    type: 'function',
                    name: func.name,
                    gpuDevices: [],
                    data: {
                      ...d.data,
                      duration: d.data.originalValue,
                      count: d.data.count,
                    },
                  },
                  true
                );
                return;
              }
            }

            // Create a function object with the information we have
            onElementClick(
              {
                id: nodeName,
                type: 'function',
                name: nodeName,
                gpuDevices: [],
                data: {
                  ...d.data,
                  duration: d.data.originalValue,
                  count: d.data.count,
                },
              },
              true
            );
          }
        });

      // Set up tooltip
      const tooltipHandler = {
        show: (d: PartitionHierarchyNode, element: SVGGElement) => {
          if (!tooltipRef.current) {
            return;
          }
          const tooltip = d3.select(tooltipRef.current);
          const valueInSeconds = d.data.originalValue || 0;
          const formattedValue =
            valueInSeconds < 0.000001 ? valueInSeconds.toExponential(6) : valueInSeconds.toFixed(6);

          // Calculate percentage relative to parent's width
          let percentageOfParent = 0;
          if (d.parent) {
            const parentWidth = d.parent.x1 - d.parent.x0;
            const currentWidth = d.x1 - d.x0;
            percentageOfParent = (currentWidth / parentWidth) * 100;
          }

          // Format name consistently with node display
          let displayName = d.data.name;

          // If node has children, remove last @ and everything after it (same as getName function)
          if (d.children && d.children.length > 0) {
            const lastAtIndex = displayName.lastIndexOf('@');
            if (lastAtIndex !== -1) {
              displayName = displayName.substring(0, lastAtIndex);
            }
          }

          const match = displayName.match(/^(.+?):(.+?)\.(.+)$/);
          let instanceId: string | undefined;
          if (match) {
            const [_, serviceName, matchInstanceId, func] = match; // eslint-disable-line
            if (d.data.serviceName) {
              displayName = `${d.data.serviceName}.${func}`;
            } else {
              displayName = `${serviceName}.${func}`;
            }
            instanceId = matchInstanceId;
          }

          let durationLabel = 'Duration';
          if (d.data.isRunning) {
            durationLabel = 'Duration (running)';
          }

          tooltip.style('visibility', 'visible').html(`
            <div style="font-family: Verdana, sans-serif;">
              <strong>${displayName}</strong><br/>
              ${instanceId ? `Instance ID: ${instanceId}<br/>` : ''}
              ${durationLabel}: ${formattedValue}s<br/>
              ${d.data.count ? `Count: ${d.data.count}<br/>` : ''}
              ${d.parent ? `Percentage in parent: ${percentageOfParent.toFixed(1)}%` : ''}
            </div>
          `);

          // Track mouse movements for all interactions
          const handleMouseMove = (event: MouseEvent) => {
            const offset = { x: 15, y: 15 }; // Offset from cursor
            const screenRightEdge = window.innerWidth;
            const tooltipWidth =
              // eslint-disable-next-line
              tooltipRef.current!.getBoundingClientRect().width;
            const tooltipHeight =
              // eslint-disable-next-line
              tooltipRef.current!.getBoundingClientRect().height;

            // Check if tooltip would be too close to right edge
            const wouldBeCloseToRightEdge =
              event.clientX + tooltipWidth + offset.x > screenRightEdge - 400;

            // Position tooltip to the left of cursor if too close to right edge
            const left = wouldBeCloseToRightEdge
              ? event.clientX - tooltipWidth - offset.x
              : event.clientX + offset.x;

            // Check if tooltip would be too close to bottom edge
            const screenBottomEdge = window.innerHeight;
            const wouldBeCloseToBottomEdge =
              event.clientY + tooltipHeight + offset.y > screenBottomEdge - 400;

            // Position tooltip above cursor if too close to bottom edge
            const top = wouldBeCloseToBottomEdge
              ? event.clientY - tooltipHeight - offset.y
              : event.clientY + offset.y;

            tooltip.style('left', `${left}px`).style('top', `${top}px`);

            // Store current position for future references
            tooltip.datum({ x: left, y: top });
          };

          // Clean up existing event listener if any
          document.removeEventListener('mousemove', handleMouseMove);

          // Add the new event listener to document instead of element for better tracking
          document.addEventListener('mousemove', handleMouseMove);

          // Position the tooltip at a reasonable initial position
          const rect = element.getBoundingClientRect();
          handleMouseMove(
            new MouseEvent('mousemove', {
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              bubbles: true,
            })
          );

          // Update hide method to remove document event listener
          tooltipHandler.hide = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            if (tooltipRef.current) {
              d3.select(tooltipRef.current).style('visibility', 'hidden');
            }
          };
        },
        hide: () => {
          if (!tooltipRef.current) {
            return;
          }
          d3.select(tooltipRef.current).style('visibility', 'hidden');
        },
      };

      chart.tooltip(tooltipHandler);

      // Set up details handler
      chart.setDetailsElement(detailsRef.current);

      // Render chart
      d3.select(container).datum(transformedData).call(chart);

      chartRef.current = chart;

      // Add CSS for flame graph
      const style = document.createElement('style');
      style.textContent = `
      .d3-flame-graph rect {
        stroke: #474747;
        stroke-width: 1;
        fill-opacity: .8;
      }
      
      .d3-flame-graph rect:hover {
        stroke: #000;
        stroke-width: 1.5;
        cursor: pointer;
      }
      
      .d3-flame-graph rect.dimmed {
        fill-opacity: .2;
      }
      
      .d3-flame-graph-label {
        pointer-events: none;
        white-space: nowrap;
        text-overflow: ellipsis;
        overflow: hidden;
        font-size: 12px;
        font-family: Verdana;
        margin-left: 4px;
        margin-right: 4px;
        line-height: 1.5;
        padding: 0 0 0;
        font-weight: 400;
        color: black;
        text-align: left;
      }
      
      .d3-flame-graph .fade {
        opacity: 0.6 !important;
      }
      
      .d3-flame-graph .title {
        font-size: 20px;
        font-family: Verdana;
      }
      
      .d3-flame-graph-tip {
        line-height: 1.4;
        font-family: Verdana, sans-serif;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        border-radius: 4px;
        padding: 8px;
        position: fixed;
        z-index: 10000;
        visibility: hidden;
        pointer-events: none;
        max-width: 300px;
        word-wrap: break-word;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .partition {
        border: none;
        outline: none;
      }
    `;
      document.head.appendChild(style);

      return () => {
        if (container) {
          if (flameChartRef.current) {
            flameChartRef.current.destroy();
          }
          d3.select(container).selectAll('*').remove();
        }
        document.head.removeChild(style);
      };
      // eslint-disable-next-line
    }, [flameData, colorMode]);

    useEffect(() => {
      if (searchTerm && searchTerm.trim() !== '') {
        chartRef.current?.search(searchTerm);
      } else {
        chartRef.current?.clear();
      }
    }, [searchTerm, flameData]);

    const transformFlameData = (data: FlameGraphData): FlameNode => {
      // Use the exported hierarchy building function
      const hierarchyNode = buildCompleteHierarchy(data, currentTimestamp);

      // Convert HierarchyNode to FlameNode format
      const convertToFlameNode = (node: HierarchyNode): FlameNode => {
        return {
          name: node.name,
          customValue: node.customValue,
          totalInParent: node.totalInParent,
          startTime: node.startTime,
          originalValue: node.originalValue,
          count: node.count,
          children: node.children?.map(convertToFlameNode),
          hide: node.hide,
          fade: node.fade,
          highlight: node.highlight,
          dimmed: node.dimmed,
          serviceName: node.serviceName,
          value: node.value,
          delta: node.delta,
          isRunning: node.isRunning,
          extras: node.extras,
        };
      };

      return convertToFlameNode(hierarchyNode);
    };

    // Function to export the SVG visualization
    const exportSvg = () => {
      if (!svgRef.current) {
        return;
      }

      // Get the SVG element
      const svgElement = svgRef.current;

      // Create a copy of the SVG to avoid modifying the original
      const svgCopy = svgElement.cloneNode(true) as SVGSVGElement;

      // Set the proper dimensions and styling
      svgCopy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svgCopy.setAttribute('width', svgElement.clientWidth.toString());
      svgCopy.setAttribute('height', svgElement.clientHeight.toString());

      // Convert to a string
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgCopy);

      // Create a blob from the SVG string
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      // Create a download link and trigger the download
      const a = document.createElement('a');
      a.href = url;
      a.download = `ray-flame-visualization-${new Date().toISOString().slice(0, 10)}.svg`;
      document.body.appendChild(a);
      a.click();

      // Clean up
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // Expose exportSvg method
    useImperativeHandle(ref, () => ({
      exportSvg,
    }));

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '500px',
          position: 'relative',
          backgroundColor: 'transparent',
          fontFamily: 'Verdana, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          margin: '120px 0 20px 0',
          maxWidth: '80%',
          overflow: 'hidden', // Prevent scrollbars during zoom/pan
        }}
      />
    );
  }
);

export default FlameVisualization;
