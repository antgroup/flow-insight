import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { GraphData, PhysicalViewData, FlameGraphData, FlameTreeNode } from '../types';

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
  value: number;
  originalValue?: number;
  count?: number;
  children?: FlameNode[];
  hide?: boolean;
  fade?: boolean;
  highlight?: boolean;
  dimmed?: boolean;
  serviceName?: string;
  delta?: number;
  isRunning?: boolean;
  extras?: {
    v8_jit?: boolean;
    javascript?: boolean;
    optimized?: number;
  };
};

type LayoutNode = {
  data: FlameNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parent?: LayoutNode;
  children: LayoutNode[];
  pathId: string;
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

// Convert FlameTreeNode to FlameNode
const convertFlameTreeToFlameNode = (
  treeNode: FlameTreeNode,
  currentTimestamp: number
): FlameNode => {
  const convertNode = (node: FlameTreeNode): FlameNode => {
    const children = node.children?.map(child => convertNode(child));

    let originalValue: number;
    let isRunning: boolean;

    if (node.id === 'root' || node.id === '_main' || node.endTime === -1) {
      originalValue = children
        ? children.reduce((sum, child) => sum + (child.originalValue || 0), 0)
        : 0.001;
      isRunning = false;
    } else {
      const startTimeSeconds = node.startTime / 1000;
      const endTimeSeconds = node.endTime <= 0 ? currentTimestamp / 1000 : node.endTime / 1000;
      originalValue = endTimeSeconds - startTimeSeconds;
      isRunning = node.endTime <= 0;
    }

    // Use originalValue as the sizing value
    let value = originalValue;
    if (value <= 0) {
      value = 0.001; // Minimum visible value
    }

    // For parent nodes, ensure value is at least the sum of children
    if (children && children.length > 0) {
      const childrenSum = children.reduce((sum, child) => sum + child.value, 0);
      value = Math.max(value, childrenSum);
    }

    return {
      name: node.id,
      value: value,
      originalValue: originalValue,
      count: 1,
      children: children,
      hide: false,
      fade: false,
      highlight: false,
      dimmed: false,
      isRunning: isRunning,
    };
  };

  return convertNode(treeNode);
};

// Custom layout function
const createLayout = (data: FlameNode, width: number, cellHeight: number): LayoutNode => {
  const generatePathId = (node: LayoutNode): string => {
    const path: string[] = [];
    let current: LayoutNode | undefined = node;
    while (current) {
      path.unshift(current.data.name);
      current = current.parent;
    }
    return path.join('->');
  };

  const layoutNode = (
    node: FlameNode,
    x: number,
    y: number,
    availableWidth: number,
    depth: number,
    parent?: LayoutNode
  ): LayoutNode => {
    const currentLayoutNode: LayoutNode = {
      data: node,
      x: x,
      y: y,
      width: availableWidth,
      height: cellHeight,
      depth: depth,
      parent: parent,
      children: [],
      pathId: '',
    };

    // Generate path ID
    currentLayoutNode.pathId = generatePathId(currentLayoutNode);

    if (node.children && node.children.length > 0) {
      const visibleChildren = node.children.filter(child => !child.hide);

      if (visibleChildren.length > 0) {
        // Use parent's value for proportional calculation, not sum of children
        const parentValue = node.value;
        let currentX = x;

        visibleChildren.forEach((child, index) => {
          // Calculate child width as proportion of parent's width based on child's value relative to parent
          const childWidth =
            parentValue > 0
              ? (child.value / parentValue) * availableWidth
              : availableWidth / visibleChildren.length;

          const childLayoutNode = layoutNode(
            child,
            currentX,
            y + cellHeight, // Children go above parent in flame graph
            childWidth,
            depth + 1,
            currentLayoutNode
          );

          currentLayoutNode.children.push(childLayoutNode);
          currentX += childWidth;
        });
      }
    }

    return currentLayoutNode;
  };

  return layoutNode(data, 0, cellHeight, width, 0);
};

// Color mapper
const getNodeColor = (node: LayoutNode, colorMode: string): string => {
  switch (colorMode) {
    case 'cold':
      const vector = generateColorVector(node.data.name);
      return calculateColor('cold', vector);
    default:
      const normalizedValue = generateColorVector(node.data.name);
      return calculateColor(colorMode, normalizedValue);
  }
};

// Format node name for display
const getDisplayName = (name: string): string => {
  if (name === '_main') {
    return 'main';
  }

  const match = name.match(/^(.+?):(.+?)\.(.+)$/);
  if (match) {
    const [_, serviceName, _1, func] = match;
    return `${serviceName}.${func}`;
  }

  return name;
};

// Search functionality
const searchNodes = (root: LayoutNode, searchTerm: string): void => {
  const resetSearch = (node: LayoutNode) => {
    node.data.hide = false;
    node.data.highlight = false;
    node.data.dimmed = false;
    node.children.forEach(child => resetSearch(child));
  };

  if (!searchTerm || searchTerm.trim() === '') {
    resetSearch(root);
    return;
  }

  const matchingPaths = new Set<string>();

  // Find all matching nodes and their paths
  const findMatches = (node: LayoutNode) => {
    const displayName = getDisplayName(node.data.name).toLowerCase();
    const isMatch = displayName.includes(searchTerm.toLowerCase());

    if (isMatch) {
      // Add this node's path and all ancestor paths
      let current: LayoutNode | undefined = node;
      while (current) {
        matchingPaths.add(current.pathId);
        current = current.parent;
      }
    }

    node.children.forEach(child => findMatches(child));
  };

  // Apply visibility based on matching paths
  const applyVisibility = (node: LayoutNode) => {
    node.data.hide = !matchingPaths.has(node.pathId);
    node.data.highlight = false;
    node.data.dimmed = false;
    node.children.forEach(child => applyVisibility(child));
  };

  findMatches(root);
  applyVisibility(root);
};

// Zoom functionality
const zoomToNode = (
  root: LayoutNode,
  targetNode: LayoutNode,
  width: number,
  cellHeight: number
): LayoutNode => {
  // Create a copy of the target node's data for zooming, including parent path
  const createZoomedData = (node: LayoutNode): FlameNode => {
    return {
      name: node.data.name,
      value: node.data.value,
      originalValue: node.data.originalValue,
      count: node.data.count,
      children: node.children.map(child => createZoomedData(child)),
      hide: false,
      fade: false,
      highlight: false,
      dimmed: false,
      serviceName: node.data.serviceName,
      delta: node.data.delta,
      isRunning: node.data.isRunning,
      extras: node.data.extras,
    };
  };

  // Build the path from root to target node
  const buildPath = (node: LayoutNode): LayoutNode[] => {
    const path: LayoutNode[] = [];
    let current: LayoutNode | undefined = node;
    while (current) {
      path.unshift(current);
      current = current.parent;
    }
    return path;
  };

  const pathToTarget = buildPath(targetNode);

  // Create zoomed data that includes the path from root to target
  const createZoomedDataWithPath = (pathIndex: number): FlameNode => {
    if (pathIndex >= pathToTarget.length) {
      return createZoomedData(targetNode);
    }

    const currentNode = pathToTarget[pathIndex];

    if (pathIndex === pathToTarget.length - 1) {
      // This is the target node, include all its children
      return createZoomedData(currentNode);
    } else {
      // This is an ancestor, only include the path to target
      return {
        name: currentNode.data.name,
        value: currentNode.data.value,
        originalValue: currentNode.data.originalValue,
        count: currentNode.data.count,
        children: [createZoomedDataWithPath(pathIndex + 1)],
        hide: false,
        fade: pathIndex < pathToTarget.length - 1, // Fade ancestors
        highlight: false,
        dimmed: false,
        serviceName: currentNode.data.serviceName,
        delta: currentNode.data.delta,
        isRunning: currentNode.data.isRunning,
        extras: currentNode.data.extras,
      };
    }
  };

  // Create new layout with the path preserved
  const zoomedData = createZoomedDataWithPath(0);
  return createLayout(zoomedData, width, cellHeight);
};

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
    const svgRef = useRef<SVGSVGElement | null>(null);
    const layoutRef = useRef<LayoutNode | null>(null);
    const originalLayoutRef = useRef<LayoutNode | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);

    const cellHeight = 18;

    useEffect(() => {
      if (!containerRef.current || !flameData) {
        return;
      }

      const container = containerRef.current;
      const width = container.clientWidth;

      // Create tooltip element
      if (!tooltipRef.current) {
        const tooltip = document.createElement('div');
        tooltip.style.position = 'fixed';
        tooltip.style.visibility = 'hidden';
        tooltip.style.pointerEvents = 'none';
        tooltip.style.zIndex = '999999';
        tooltip.style.background = 'rgba(0, 0, 0, 0.9)';
        tooltip.style.color = 'white';
        tooltip.style.padding = '10px';
        tooltip.style.borderRadius = '6px';
        tooltip.style.fontSize = '12px';
        tooltip.style.maxWidth = '300px';
        tooltip.style.wordWrap = 'break-word';
        tooltip.style.fontFamily = 'Verdana, sans-serif';
        tooltip.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        tooltip.style.border = '1px solid rgba(255, 255, 255, 0.2)';
        document.body.appendChild(tooltip);
        tooltipRef.current = tooltip;
      }

      // Transform data
      const transformedData = convertFlameTreeToFlameNode(flameData.root, currentTimestamp);

      // Create layout
      const layout = createLayout(transformedData, width, cellHeight);
      layoutRef.current = layout;
      originalLayoutRef.current = layout;

      // Apply search if needed
      if (searchTerm && searchTerm.trim() !== '') {
        searchNodes(layout, searchTerm);
      }

      renderFlameGraph(layout, width);

      // Cleanup tooltip on unmount
      return () => {
        if (tooltipRef.current) {
          document.body.removeChild(tooltipRef.current);
          tooltipRef.current = null;
        }
      };
    }, [flameData, colorMode, currentTimestamp]);

    useEffect(() => {
      if (layoutRef.current) {
        if (searchTerm && searchTerm.trim() !== '') {
          searchNodes(layoutRef.current, searchTerm);
        } else {
          // Reset search
          searchNodes(layoutRef.current, '');
        }
        const width = containerRef.current?.clientWidth || 960;
        renderFlameGraph(layoutRef.current, width);
      }
    }, [searchTerm]);

    const renderFlameGraph = (layout: LayoutNode, width: number) => {
      if (!containerRef.current) return;

      // Clear previous content
      containerRef.current.innerHTML = '';

      // Calculate total height by collecting all visible nodes
      const getAllVisibleNodes = (node: LayoutNode): LayoutNode[] => {
        if (node.data.hide) return [];
        const nodes = [node];
        node.children.forEach(child => {
          nodes.push(...getAllVisibleNodes(child));
        });
        return nodes;
      };

      const allNodes = getAllVisibleNodes(layout);
      const maxDepth = Math.max(...allNodes.map(node => node.depth));
      const totalHeight = (maxDepth + 1) * cellHeight;

      // Create SVG
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', width.toString());
      svg.setAttribute('height', totalHeight.toString());
      svg.setAttribute('class', 'partition d3-flame-graph');
      svg.style.margin = '0';
      svg.style.display = 'block';

      svgRef.current = svg;

      // Render all visible nodes
      allNodes.forEach(node => {
        if (node.data.hide || node.width < 1) return;

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // Position from bottom up (flame graph style)
        const yPosition = totalHeight - (node.depth + 1) * cellHeight;
        group.setAttribute('transform', `translate(${node.x},${yPosition})`);
        group.setAttribute('width', node.width.toString());
        group.setAttribute('height', cellHeight.toString());
        group.setAttribute('name', getDisplayName(node.data.name));

        // Create rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('width', node.width.toString());
        rect.setAttribute('height', cellHeight.toString());
        rect.setAttribute('fill', getNodeColor(node, colorMode));
        rect.style.stroke = '#474747';
        rect.style.strokeWidth = '1';
        rect.style.fillOpacity = node.data.fade ? '0.6' : '0.8';
        rect.style.cursor = 'pointer';

        // Create label
        const foreignObject = document.createElementNS(
          'http://www.w3.org/2000/svg',
          'foreignObject'
        );
        foreignObject.setAttribute('width', node.width.toString());
        foreignObject.setAttribute('height', cellHeight.toString());

        const div = document.createElement('div');
        div.className = 'd3-flame-graph-label';
        div.style.display = 'block';
        div.style.pointerEvents = 'none';
        div.style.whiteSpace = 'nowrap';
        div.style.textOverflow = 'ellipsis';
        div.style.overflow = 'hidden';
        div.style.fontSize = '12px';
        div.style.fontFamily = 'Verdana';
        div.style.marginLeft = '4px';
        div.style.marginRight = '4px';
        div.style.lineHeight = '1.5';
        div.style.fontWeight = '400';
        div.style.color = 'black';
        div.style.textAlign = 'left';
        div.textContent = getDisplayName(node.data.name);

        foreignObject.appendChild(div);

        // Add hover effects and tooltip to the group (covers both rect and text)
        group.addEventListener('mouseenter', event => {
          rect.style.stroke = '#000';
          rect.style.strokeWidth = '1.5';
          showTooltip(node, event);
        });
        group.addEventListener('mouseleave', () => {
          rect.style.stroke = '#474747';
          rect.style.strokeWidth = '1';
          hideTooltip();
        });
        group.addEventListener('mousemove', event => {
          updateTooltipPosition(event);
        });

        // Add click handler for zoom functionality
        group.addEventListener('click', event => {
          event.stopPropagation();
          handleZoomClick(node);
        });

        group.appendChild(rect);
        group.appendChild(foreignObject);
        svg.appendChild(group);
      });

      containerRef.current.appendChild(svg);
    };

    const showTooltip = (node: LayoutNode, event: MouseEvent) => {
      if (!tooltipRef.current) return;

      const tooltip = tooltipRef.current;
      const valueInSeconds = node.data.originalValue || 0;
      const formattedValue =
        valueInSeconds < 0.000001 ? valueInSeconds.toExponential(6) : valueInSeconds.toFixed(6);

      // Calculate percentage relative to parent's width
      let percentageOfParent = 0;
      if (node.parent) {
        const parentWidth = node.parent.width;
        const currentWidth = node.width;
        percentageOfParent = (currentWidth / parentWidth) * 100;
      }

      const displayName = getDisplayName(node.data.name);
      let durationLabel = 'Duration';
      if (node.data.isRunning) {
        durationLabel = 'Duration (running)';
      }

      tooltip.innerHTML = `
                <div>
                    <strong>${displayName}</strong><br/>
                    ${durationLabel}: ${formattedValue}s<br/>
                    ${node.data.count ? `Count: ${node.data.count}<br/>` : ''}
                    ${node.parent ? `Percentage in parent: ${percentageOfParent.toFixed(1)}%` : ''}
                </div>
            `;

      tooltip.style.visibility = 'visible';
      updateTooltipPosition(event);
    };

    const hideTooltip = () => {
      if (tooltipRef.current) {
        tooltipRef.current.style.visibility = 'hidden';
      }
    };

    const updateTooltipPosition = (event: MouseEvent) => {
      if (!tooltipRef.current) return;

      const tooltip = tooltipRef.current;
      const offset = { x: 15, y: 15 };
      const screenRightEdge = window.innerWidth;
      const tooltipWidth = tooltip.getBoundingClientRect().width;
      const tooltipHeight = tooltip.getBoundingClientRect().height;

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

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    const handleZoomClick = (node: LayoutNode) => {
      // Hide tooltip when clicking
      hideTooltip();

      // Check if this is a main/root node - these should reset to full view
      const isMainNode =
        node.data.name === '_main' ||
        node.data.name === 'root' ||
        node.data.name === 'main' ||
        node.data.name.includes('main');

      // For main nodes, reset to full flame graph view and trigger element selection
      if (isMainNode) {
        // Reset to original layout (remove all zoom states)
        if (containerRef.current && originalLayoutRef.current) {
          const width = containerRef.current.clientWidth;
          layoutRef.current = originalLayoutRef.current;

          // Re-apply search if needed
          if (searchTerm && searchTerm.trim() !== '') {
            searchNodes(originalLayoutRef.current, searchTerm);
          }

          renderFlameGraph(originalLayoutRef.current, width);
        }

        // Also trigger element selection
        handleNodeClick(node);
        return;
      }

      // For non-main nodes, check if we can zoom further
      // If the node has no children or is too small, just select it
      if (!node.children || node.children.length === 0 || node.width < 50) {
        handleNodeClick(node);
        return;
      }

      // Find the node in the original layout to preserve parent context
      const findNodeInOriginal = (
        searchNode: LayoutNode,
        targetName: string,
        targetDepth: number
      ): LayoutNode | null => {
        if (searchNode.data.name === targetName && searchNode.depth === targetDepth) {
          return searchNode;
        }
        for (const child of searchNode.children) {
          const found = findNodeInOriginal(child, targetName, targetDepth);
          if (found) return found;
        }
        return null;
      };

      // Zoom to this node while preserving parent context
      if (containerRef.current && originalLayoutRef.current) {
        const width = containerRef.current.clientWidth;
        const originalNode = findNodeInOriginal(
          originalLayoutRef.current,
          node.data.name,
          node.depth
        );

        if (originalNode) {
          const zoomedLayout = zoomToNode(
            originalLayoutRef.current,
            originalNode,
            width,
            cellHeight
          );
          layoutRef.current = zoomedLayout;
          renderFlameGraph(zoomedLayout, width);
        } else {
          // If we can't find the original node, just select this one
          handleNodeClick(node);
        }
      }
    };

    const handleNodeClick = (node: LayoutNode) => {
      const nodeName = node.data.name;

      // Check if the name follows the expected format: actor_class:actor_id.func
      const match = nodeName.match(/^(.+?):(.+?)\.(.+)$/);

      if (match) {
        // This is an actor method
        const [_, serviceName, instanceId, funcName] = match;

        // Try to find the service in physicalViewData if available
        let serviceGpuDevices: any[] = [];

        if (physicalViewData && physicalViewData.physicalView) {
          for (const [_, nodeData] of Object.entries(physicalViewData.physicalView)) {
            if (nodeData.services && nodeData.services[instanceId]) {
              const physicalService = nodeData.services[instanceId];
              const extendedService = physicalService as any;
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
            onElementClick(
              {
                id: method.id,
                type: 'method',
                name: method.name,
                gpuDevices: serviceGpuDevices,
                data: {
                  ...node.data,
                  duration: node.data.originalValue,
                  count: node.data.count,
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
              ...node.data,
              duration: node.data.originalValue,
              count: node.data.count,
            },
          },
          true
        );
      } else {
        // This is a regular function
        if (graphData) {
          const func = graphData.functions.find(f => f.name === nodeName);

          if (func) {
            onElementClick(
              {
                id: func.id,
                type: 'function',
                name: func.name,
                gpuDevices: [],
                data: {
                  ...node.data,
                  duration: node.data.originalValue,
                  count: node.data.count,
                },
              },
              true
            );
            return;
          }
        }

        onElementClick(
          {
            id: nodeName,
            type: 'function',
            name: nodeName,
            gpuDevices: [],
            data: {
              ...node.data,
              duration: node.data.originalValue,
              count: node.data.count,
            },
          },
          true
        );
      }
    };

    const exportSvg = () => {
      if (!svgRef.current) {
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
      a.download = `ray-flame-visualization-${new Date().toISOString().slice(0, 10)}.svg`;
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

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
          overflow: 'hidden',
        }}
      />
    );
  }
);

export default FlameVisualization;
