import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState, useMemo } from 'react';

import { GraphData, PhysicalViewData, FlameGraphData, FlameTreeNode } from '../types';

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
    isRunning?: boolean; // Whether this task is currently running
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
        const [flattenedGroups, setFlattenedGroups] = useState<Set<string>>(new Set());
        const [savedCollapsedState, setSavedCollapsedState] = useState<Set<string> | null>(null);
        const [savedFlattenedState, setSavedFlattenedState] = useState<Set<string> | null>(null);
        const [isDataLoading, setIsDataLoading] = useState(false);

        // Chart dimensions
        const chartHeight = 500;
        const rowHeight = 20;
        const serviceRowHeight = 22;
        const methodRowHeight = 21;
        const labelWidth = 320;
        const timelineHeight = 50;
        const indentWidth = 20;

        // Transform flameData to hierarchical tree tasks using the tree structure directly
        const transformFlameDataToTreeTasks = (data: FlameGraphData): CustomTask[] => {
            if (!data || !data.root) {
                console.warn('Invalid flame graph data format:', data);
                return [];
            }

            // Helper function to parse service.method from ID
            const parseServiceMethod = (
                id: string
            ): { serviceName: string; methodName: string; displayName: string } => {
                if (id === 'root') {
                    return { serviceName: 'System', methodName: 'root', displayName: 'Root' };
                }
                if (id === '_main') {
                    return { serviceName: 'System', methodName: 'main', displayName: 'Main Execution Flow' };
                }

                const match = id.match(/^(.+?):(.+?)\.(.+)$/);
                if (match) {
                    const [_, serviceName, _instanceId, methodName] = match;
                    return {
                        serviceName,
                        methodName,
                        displayName: `${serviceName}.${methodName}`,
                    };
                }

                // Fallback for non-standard names
                const parts = id.split('.');
                if (parts.length >= 2) {
                    return {
                        serviceName: parts[0],
                        methodName: parts[parts.length - 1],
                        displayName: `${parts[0]}.${parts[parts.length - 1]}`,
                    };
                }

                return { serviceName: 'Unknown', methodName: id, displayName: id };
            };

            // Convert FlameTreeNode tree to flat task list with proper timing
            const flatTasks: CustomTask[] = [];
            const allStartTimes: number[] = [];
            const allEndTimes: number[] = [];

            // Collect all timing information from the tree, excluding _main node
            const collectTimings = (node: FlameTreeNode): void => {
                // Skip _main node as it's always running and would skew the timing
                if (node.id !== '_main' && node.id !== 'root') {
                    // Convert from milliseconds to seconds
                    allStartTimes.push(node.startTime / 1000);
                    // Handle running tasks (endTime <= 0)
                    const endTime = node.endTime <= 0 ? currentTimestamp / 1000 : node.endTime / 1000;
                    allEndTimes.push(endTime);
                }

                if (node.children) {
                    node.children.forEach(child => collectTimings(child));
                }
            };

            collectTimings(data.root);

            // Don't create a separate main task - we'll use the existing _main node

            // Recursive function to convert tree nodes to tasks
            const convertTreeToTasks = (
                node: FlameTreeNode,
                level: number,
                colorIndex: number,
                parentTaskId?: string
            ): void => {
                const { serviceName, methodName, displayName } = parseServiceMethod(node.id);
                const functionColor = CALLER_COLORS[colorIndex % CALLER_COLORS.length];

                // Calculate timing from node data (convert from milliseconds to seconds)
                const startTime = node.startTime / 1000;
                let endTime: number;

                // Special handling for _main node - use last end time across entire tree
                if (node.id === '_main') {
                    // Calculate the last end time across all nodes in the tree
                    const collectAllEndTimes = (treeNode: FlameTreeNode): number[] => {
                        const endTimes: number[] = [];
                        if (treeNode.id !== '_main' && treeNode.id !== 'root') {
                            const nodeEndTime =
                                treeNode.endTime <= 0 ? currentTimestamp / 1000 : treeNode.endTime / 1000;
                            endTimes.push(nodeEndTime);
                        }
                        if (treeNode.children) {
                            treeNode.children.forEach(child => {
                                endTimes.push(...collectAllEndTimes(child));
                            });
                        }
                        return endTimes;
                    };

                    // Get all end times from the entire tree starting from the root
                    const allTreeEndTimes = collectAllEndTimes(data.root);
                    if (allTreeEndTimes.length > 0) {
                        endTime = Math.max(...allTreeEndTimes);
                    } else {
                        // Fallback if no other nodes exist
                        endTime = startTime + 0.001;
                    }
                } else {
                    // For all other nodes, use their actual timing data
                    endTime = node.endTime <= 0 ? currentTimestamp / 1000 : node.endTime / 1000;
                }

                // Generate unique ID
                const uniqueId = `${node.id}_${level}_${flatTasks.length}_${startTime}`;

                // Determine if task is running
                const isRunning = node.endTime <= 0;

                const task: CustomTask = {
                    id: uniqueId,
                    name: displayName,
                    fullName: node.id,
                    startTime: startTime,
                    endTime: endTime,
                    progress: isRunning ? 50 : 100, // Running tasks show 50% progress
                    type: node.id === '_main' ? 'main' : 'method', // _main node is the main task
                    serviceName: serviceName,
                    methodName: methodName,
                    parentId: parentTaskId,
                    level: level,
                    children: [],
                    callers: [],
                    callees: [],
                    color: node.id === '_main' ? COLORS.primary : functionColor,
                    executionCount: 1,
                    isRunning: isRunning,
                };

                flatTasks.push(task);

                // Recursively process children
                if (node.children && node.children.length > 0) {
                    // Sort children by start time
                    const sortedChildren = [...node.children].sort((a, b) => a.startTime - b.startTime);

                    sortedChildren.forEach((child, index) => {
                        convertTreeToTasks(child, level + 1, colorIndex + index + 1, uniqueId);
                    });
                }
            };

            // Convert the tree to flat tasks
            if (data.root.children && data.root.children.length > 0) {
                data.root.children.forEach((child, index) => {
                    // Special handling for _main node - it should be at level 0
                    const level = child.id === '_main' ? 0 : 1;
                    convertTreeToTasks(child, level, index, undefined);
                });
            }

            console.log(
                `Created gantt chart with ${flatTasks.length} total tasks from tree with ${data.root.children?.length || 0} root functions`
            );

            // Debug: Log task hierarchy
            const mainTasks = flatTasks.filter(t => t.type === 'main');
            const methodTasks = flatTasks.filter(t => t.type === 'method');
            console.log(`Main tasks: ${mainTasks.length}, Method tasks: ${methodTasks.length}`);
            console.log('Task levels:', flatTasks.map(t => `${t.name}(L${t.level})`).join(', '));

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
                // Always show root-level tasks (level 0 and tasks without parents)
                if (task.level === 0 || !task.parentId) {
                    visibleTasks.push({
                        ...task,
                        isCollapsed: collapsedNodes.has(task.id),
                    });
                    return;
                }

                // Always show main tasks regardless of level
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
                    } else {
                        console.log(`Hiding task due to collapsed ancestor: ${task.name} (L${task.level})`);
                    }
                }
            });

            // Safety check: If no tasks are visible but we have tasks, show at least the first-level tasks
            if (visibleTasks.length === 0 && tasks.length > 0) {
                console.warn('No visible tasks detected, falling back to showing level 0 and 1 tasks');
                tasks.forEach(task => {
                    if (task.level <= 1) {
                        visibleTasks.push({
                            ...task,
                            isCollapsed: collapsedNodes.has(task.id),
                        });
                    }
                });
            }

            console.log(`Visible tasks: ${visibleTasks.length}/${tasks.length}`);
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
                const durationSeconds = task.endTime - task.startTime; // Already in seconds

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

            // Handle main task clicks for inspection (but not collapse since main doesn't collapse)
            if (task.type === 'main') {
                const taskName = task.name;
                const durationSeconds = task.endTime - task.startTime;

                const elementData: any = {
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

                onElementClick(elementData, true);
                return;
            }
        };

        // Handle level expansion controls
        const expandOneLevel = () => {
            const newCollapsed = new Set(collapsedNodes);

            // Find the deepest level that has collapsed nodes
            const collapsedLevels = new Map<number, string[]>();
            tasks.forEach(task => {
                if (newCollapsed.has(task.id)) {
                    if (!collapsedLevels.has(task.level)) {
                        collapsedLevels.set(task.level, []);
                    }
                    collapsedLevels.get(task.level)!.push(task.id);
                }
            });

            if (collapsedLevels.size > 0) {
                // Find the shallowest level with collapsed nodes and expand them
                const levelsArray = Array.from(collapsedLevels.keys()).sort((a, b) => a - b);
                const targetLevel = levelsArray[0];
                const tasksToExpand = collapsedLevels.get(targetLevel) || [];

                tasksToExpand.forEach(taskId => {
                    newCollapsed.delete(taskId);
                });

                setCollapsedNodes(newCollapsed);

                // If we're in search mode, also update the saved state
                if (savedCollapsedState !== null) {
                    const updatedSavedState = new Set(savedCollapsedState);
                    tasksToExpand.forEach(taskId => {
                        updatedSavedState.delete(taskId);
                    });
                    setSavedCollapsedState(updatedSavedState);
                }

                console.log(`Expanded level ${targetLevel}, expanded ${tasksToExpand.length} nodes`);
            }
        };

        const collapseOneLevel = () => {
            const newCollapsed = new Set(collapsedNodes);

            // Find the deepest visible level that has expandable nodes (nodes with children)
            const expandableByLevel = new Map<number, string[]>();

            // Get currently visible tasks to determine what levels are shown
            // Use filtered tasks instead of visibleTasks to respect search state
            const currentlyVisible = filteredTasks.length > 0 ? filteredTasks : getVisibleTasks();
            const maxVisibleLevel = Math.max(0, ...currentlyVisible.map(t => t.level));

            // When searching, find the minimum level of search results to prevent over-collapsing
            const hasSearchTerm = searchTerm && searchTerm.trim() !== '';
            const minSearchLevel = hasSearchTerm ? Math.min(...currentlyVisible.map(t => t.level)) : 0;

            // Find tasks at the deepest visible level that have children and are not collapsed
            tasks.forEach(task => {
                if (task.level <= maxVisibleLevel && !newCollapsed.has(task.id)) {
                    const hasChildren = tasks.some(t => t.parentId === task.id);
                    if (hasChildren) {
                        // During search, don't collapse tasks at or below the minimum search result level
                        if (hasSearchTerm && task.level <= minSearchLevel) {
                            return; // Skip collapsing this task as it would hide search results
                        }

                        if (!expandableByLevel.has(task.level)) {
                            expandableByLevel.set(task.level, []);
                        }
                        expandableByLevel.get(task.level)!.push(task.id);
                    }
                }
            });

            if (expandableByLevel.size > 0) {
                // Find the deepest level with expandable nodes and collapse them
                const levelsArray = Array.from(expandableByLevel.keys()).sort((a, b) => b - a);
                const targetLevel = levelsArray[0];
                const tasksToCollapse = expandableByLevel.get(targetLevel) || [];

                // Prevent collapsing all visible tasks - ensure at least root level (0) and main tasks remain visible
                let wouldHideAllTasks = false;

                // Check if collapsing these tasks would leave no visible tasks
                const testCollapsed = new Set([...newCollapsed, ...tasksToCollapse]);
                const testVisible = tasks.filter(task => {
                    // Root level tasks should always be visible
                    if (task.level === 0 || !task.parentId || task.type === 'main') {
                        return true;
                    }

                    // Check if any ancestor would be collapsed
                    let currentTask: CustomTask | undefined = task;
                    while (currentTask && currentTask.parentId) {
                        if (testCollapsed.has(currentTask.parentId)) {
                            return false;
                        }
                        const parentId: string | undefined = currentTask.parentId;
                        currentTask = tasks.find(t => t.id === parentId);
                        if (!currentTask) break;
                    }
                    return true;
                });

                // During search, also check if we would hide current search results
                const wouldHideSearchResults = hasSearchTerm && testVisible.filter(task => {
                    const lowerSearch = searchTerm.toLowerCase();
                    return task.name.toLowerCase().includes(lowerSearch) ||
                        task.fullName.toLowerCase().includes(lowerSearch);
                }).length === 0;

                wouldHideAllTasks = testVisible.length === 0 || wouldHideSearchResults;

                if (!wouldHideAllTasks) {
                    tasksToCollapse.forEach(taskId => {
                        newCollapsed.add(taskId);
                    });

                    setCollapsedNodes(newCollapsed);

                    // If we're in search mode, also update the saved state
                    if (savedCollapsedState !== null) {
                        const updatedSavedState = new Set(savedCollapsedState);
                        tasksToCollapse.forEach(taskId => {
                            updatedSavedState.add(taskId);
                        });
                        setSavedCollapsedState(updatedSavedState);
                    }

                    console.log(`Collapsed level ${targetLevel}, collapsed ${tasksToCollapse.length} nodes`);
                } else {
                    console.log('Cannot collapse further - would hide all tasks or search results');
                }
            } else if (hasSearchTerm) {
                console.log('Cannot collapse during search - would hide search results');
            }
        };

        // Handle flatten/unflatten group
        const handleFlattenGroup = (task: CustomTask, event: React.MouseEvent) => {
            event.stopPropagation(); // Prevent triggering the main task click

            const newFlattened = new Set(flattenedGroups);
            if (newFlattened.has(task.id)) {
                console.log(`Unflattening group: ${task.name} (ID: ${task.id})`);
                newFlattened.delete(task.id);
            } else {
                console.log(`Flattening group: ${task.name} (ID: ${task.id})`);
                newFlattened.add(task.id);
            }
            console.log('Current flattened groups:', Array.from(newFlattened));
            setFlattenedGroups(newFlattened);

            // If we're in search mode and user manually changes flattening, update the saved state
            // so the manual change persists when search is cleared
            if (savedFlattenedState !== null) {
                const updatedSavedState = new Set(savedFlattenedState);
                if (newFlattened.has(task.id)) {
                    updatedSavedState.add(task.id);
                } else {
                    updatedSavedState.delete(task.id);
                }
                setSavedFlattenedState(updatedSavedState);
                console.log('Updated saved flattened state during search');
            }
        };

        // Generate a unique key for this flame data to store collapse state
        const getDataKey = (data: FlameGraphData): string => {
            // Create a simple hash based on the root structure
            const rootId = data.root.id;
            const childrenCount = data.root.children?.length || 0;
            const firstChildId = data.root.children?.[0]?.id || '';
            return `gantt-collapse-${rootId}-${childrenCount}-${firstChildId}`;
        };

        // Load collapsed state from localStorage
        const loadCollapsedState = (dataKey: string): Set<string> => {
            try {
                const stored = localStorage.getItem(dataKey);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    return new Set(parsed);
                }
            } catch (error) {
                console.warn('Failed to load collapsed state from localStorage:', error);
            }
            return new Set();
        };

        // Save collapsed state to localStorage
        const saveCollapsedState = (dataKey: string, collapsed: Set<string>) => {
            try {
                localStorage.setItem(dataKey, JSON.stringify(Array.from(collapsed)));
            } catch (error) {
                console.warn('Failed to save collapsed state to localStorage:', error);
            }
        };

        // Load flattened state from localStorage
        const loadFlattenedState = (dataKey: string): Set<string> => {
            try {
                const stored = localStorage.getItem(`${dataKey}-flattened`);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    return new Set(parsed);
                }
            } catch (error) {
                console.warn('Failed to load flattened state from localStorage:', error);
            }
            return new Set();
        };

        // Save flattened state to localStorage
        const saveFlattenedState = (dataKey: string, flattened: Set<string>) => {
            try {
                localStorage.setItem(`${dataKey}-flattened`, JSON.stringify(Array.from(flattened)));
            } catch (error) {
                console.warn('Failed to save flattened state to localStorage:', error);
            }
        };

        // Update tasks when flameData changes
        useEffect(() => {
            if (flameData) {
                setIsDataLoading(true);
                const newTasks = transformFlameDataToTreeTasks(flameData);
                setTasks(newTasks);

                const dataKey = getDataKey(flameData);
                const savedCollapsed = loadCollapsedState(dataKey);

                // If we have saved state, use it; otherwise use default folding
                if (savedCollapsed.size > 0) {
                    // Validate that saved IDs still exist in current tasks
                    const validCollapsed = new Set<string>();
                    const taskIds = new Set(newTasks.map(t => t.id));

                    savedCollapsed.forEach(id => {
                        if (taskIds.has(id)) {
                            validCollapsed.add(id);
                        }
                    });

                    setCollapsedNodes(validCollapsed);
                } else {
                    // Default folding: show only main (level 0) and first level (level 1)
                    // Collapse all level 1 tasks that have children to hide level 2+
                    const autoCollapsed = new Set<string>();
                    newTasks.forEach(task => {
                        // Collapse all level 1 tasks that have children
                        // This ensures level 2, 3, 4, ... are all hidden by default
                        if (task.level === 1) {
                            const hasChildren = newTasks.some(t => t.parentId === task.id);
                            if (hasChildren) {
                                autoCollapsed.add(task.id);
                            }
                        }
                        // Also collapse any higher level tasks (level 2+) that have children
                        // This ensures deep nesting is fully collapsed
                        if (task.level >= 2) {
                            const hasChildren = newTasks.some(t => t.parentId === task.id);
                            if (hasChildren) {
                                autoCollapsed.add(task.id);
                            }
                        }
                    });
                    setCollapsedNodes(autoCollapsed);
                    // Save the default state
                    saveCollapsedState(dataKey, autoCollapsed);
                }

                // Load flattened state
                const savedFlattened = loadFlattenedState(dataKey);
                if (savedFlattened.size > 0) {
                    // Validate that saved IDs still exist in current tasks
                    const validFlattened = new Set<string>();
                    const taskIds = new Set(newTasks.map(t => t.id));

                    savedFlattened.forEach(id => {
                        if (taskIds.has(id)) {
                            validFlattened.add(id);
                        }
                    });

                    setFlattenedGroups(validFlattened);
                }

                // Data loading complete
                setIsDataLoading(false);
            } else {
                // No flame data - reset tasks but don't show loading
                setTasks([]);
                setIsDataLoading(false);
            }
        }, [flameData, currentTimestamp]);

        // Save collapsed state whenever it changes
        useEffect(() => {
            if (flameData && tasks.length > 0) {
                const dataKey = getDataKey(flameData);
                saveCollapsedState(dataKey, collapsedNodes);
            }
        }, [collapsedNodes, flameData, tasks]);

        // Save flattened state whenever it changes
        useEffect(() => {
            if (flameData && tasks.length > 0) {
                const dataKey = getDataKey(flameData);
                saveFlattenedState(dataKey, flattenedGroups);
            }
        }, [flattenedGroups, flameData, tasks]);

        // Handle search-triggered unfolding of all levels and flattening first levels
        useEffect(() => {
            const hasSearchTerm = searchTerm && searchTerm.trim() !== '';

            if (hasSearchTerm) {
                // Save current collapsed state before clearing it
                if (savedCollapsedState === null) {
                    setSavedCollapsedState(new Set(collapsedNodes));
                    setCollapsedNodes(new Set()); // Clear all collapsed nodes to show all levels
                    console.log('Search triggered: expanding all levels');
                }

                // Save current flattened state (but don't auto-flatten anything)
                if (savedFlattenedState === null) {
                    setSavedFlattenedState(new Set(flattenedGroups));
                    console.log('Search triggered: saved current flattened state');
                }
            } else {
                // Restore saved collapsed state when search is cleared
                if (savedCollapsedState !== null) {
                    setCollapsedNodes(new Set(savedCollapsedState));
                    setSavedCollapsedState(null);
                    console.log('Search cleared: restoring previous collapsed state');
                }

                // Restore saved flattened state when search is cleared
                if (savedFlattenedState !== null) {
                    setFlattenedGroups(new Set(savedFlattenedState));
                    setSavedFlattenedState(null);
                    console.log('Search cleared: restoring previous flattened state');
                }
            }
        }, [
            searchTerm,
            savedCollapsedState,
            savedFlattenedState,
            collapsedNodes,
            flattenedGroups,
        ]);

        // Filter tasks based on search term (with regex support)
        const visibleTasks = getVisibleTasks();
        const filteredTasks = useMemo(() => {
            // For search, use all tasks expanded (ignore collapsed state)
            const tasksToFilter = searchTerm && searchTerm.trim() !== '' ?
                tasks.map(task => ({ ...task, isCollapsed: false })) :
                visibleTasks;

            if (!searchTerm || searchTerm.trim() === '') {
                return tasksToFilter;
            }

            const trimmedSearch = searchTerm.trim();

            // Try to create a regex pattern
            let searchRegex: RegExp | null = null;
            let useRegex = false;

            try {
                // Check if the search term looks like a regex (contains regex special chars)
                const regexChars = /[.*+?^${}()|[\]\\]/;
                if (regexChars.test(trimmedSearch)) {
                    // Try to compile as regex with case-sensitive matching
                    searchRegex = new RegExp(trimmedSearch);
                    useRegex = true;
                    console.log('Using regex search:', trimmedSearch);
                }
            } catch (error) {
                // If regex compilation fails, fall back to string search
                console.warn('Invalid regex pattern, falling back to string search:', error);
                useRegex = false;
            }

            return tasksToFilter.filter(task => {
                if (useRegex && searchRegex) {
                    // Test against both task name and full name
                    return searchRegex.test(task.name) || searchRegex.test(task.fullName);
                } else {
                    // Fallback to case-insensitive string search
                    const lowerSearch = trimmedSearch.toLowerCase();
                    return (
                        task.name.toLowerCase().includes(lowerSearch) ||
                        task.fullName.toLowerCase().includes(lowerSearch)
                    );
                }
            });
        }, [visibleTasks, searchTerm, tasks]);

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

        // Prevent rendering empty chart during data refresh by checking for valid data
        const hasValidData = flameData && flameData.root && tasks.length > 0;
        const hasVisibleTasks = filteredTasks.length > 0;
        const allTasksCollapsed = tasks.length > 0 && filteredTasks.length === 0 && !searchTerm;
        const shouldShowEmptyState = !flameData || (!hasValidData && !hasVisibleTasks && !isDataLoading);

        if (shouldShowEmptyState) {
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
                                : filteredTasks.length === 0 && tasks.length > 0
                                    ? 'No tasks match the current search criteria'
                                    : 'Loading Gantt data...'}
                        </p>
                    </div>
                </div>
            );
        }

        // Show loading indicator if data is being processed
        if (isDataLoading || (flameData && tasks.length === 0)) {
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
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
                        <h3 style={{ margin: '0 0 8px 0', color: COLORS.text }}>Loading Gantt Chart</h3>
                        <p style={{ margin: 0 }}>Processing flame graph data...</p>
                    </div>
                </div>
            );
        }

        // Special case: when all tasks are collapsed (not due to search)
        if (allTasksCollapsed) {
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
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📁</div>
                        <h3 style={{ margin: '0 0 8px 0', color: COLORS.text }}>All Tasks Collapsed</h3>
                        <p style={{ margin: 0 }}>
                            All tasks have been collapsed. Click the "+" button to expand levels or click on individual tasks to expand them.
                        </p>
                    </div>
                </div>
            );
        }

        // Special case: when search results in no matches but we have valid data
        if (filteredTasks.length === 0 && tasks.length > 0 && searchTerm) {
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
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
                        <h3 style={{ margin: '0 0 8px 0', color: COLORS.text }}>No Search Results</h3>
                        <p style={{ margin: 0 }}>
                            No tasks match "{searchTerm}". Try a different search term or clear the search to view all tasks.
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

        // Generate timeline ticks for relative time display
        const generateTimelineTicks = () => {
            const ticks = [];
            const totalDuration = maxTime - minTime;

            // Calculate available width for timeline labels
            const timelineWidth = chartWidth - labelWidth;
            const minLabelWidth = 50;
            const maxTicks = Math.floor(timelineWidth / minLabelWidth);
            const targetTicks = Math.max(4, Math.min(maxTicks, 15));

            // Calculate a nice tick interval based on duration
            const baseDivisions = Math.max(4, targetTicks - 2);
            let tickInterval: number;

            // Determine appropriate tick interval based on total duration
            const durationInSeconds = totalDuration;

            if (durationInSeconds <= 1) {
                // For very short durations, use 0.1s intervals
                const intervals = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5];
                const targetInterval = durationInSeconds / baseDivisions;
                tickInterval = intervals.find(interval => interval >= targetInterval) || 0.1;
            } else if (durationInSeconds <= 10) {
                // For short durations (1-10s), use 0.5s, 1s, 2s intervals
                const intervals = [0.1, 0.2, 0.5, 1, 2, 5];
                const targetInterval = durationInSeconds / baseDivisions;
                tickInterval = intervals.find(interval => interval >= targetInterval) || 1;
            } else if (durationInSeconds <= 60) {
                // For medium durations (10s-1min), use 1s, 2s, 5s, 10s intervals
                const intervals = [1, 2, 5, 10, 15, 30];
                const targetInterval = durationInSeconds / baseDivisions;
                tickInterval = intervals.find(interval => interval >= targetInterval) || 10;
            } else {
                // For long durations, use minute-based intervals
                const intervals = [5, 10, 15, 30, 60, 120, 300]; // 5s to 5min
                const targetInterval = durationInSeconds / baseDivisions;
                tickInterval = intervals.find(interval => interval >= targetInterval) || 60;
            }

            // Generate ticks starting from 0 (relative to minTime)
            const numTicks = Math.ceil(totalDuration / tickInterval) + 2; // +2 for padding

            for (let i = 0; i <= numTicks; i++) {
                const relativeTime = i * tickInterval;
                const absoluteTime = minTime + relativeTime;

                // Only add ticks within reasonable bounds
                if (relativeTime <= totalDuration * 1.2) {
                    // 20% padding
                    ticks.push(absoluteTime);
                }
            }

            // Limit to maxTicks
            if (ticks.length > maxTicks) {
                const step = Math.ceil(ticks.length / maxTicks);
                return ticks.filter((_, index) => index % step === 0);
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

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontWeight: '600', fontSize: '14px', color: COLORS.text }}>
                                Levels:
                            </span>
                            <button
                                onClick={expandOneLevel}
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
                                title="Expand one level deeper"
                            >
                                📂+
                            </button>
                            <button
                                onClick={collapseOneLevel}
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
                                title="Collapse one level"
                            >
                                📂-
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
                            Duration: {(maxTime - minTime).toFixed(3)}s
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div
                                style={{
                                    width: '16px',
                                    height: '12px',
                                    backgroundColor: COLORS.accent,
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '8px',
                                    color: 'white',
                                }}
                            >
                                ⬆
                            </div>
                            <span style={{ fontWeight: '500' }}>
                                Manual Flatten (click ⬆ to move child bars to left edge)
                            </span>
                        </div>
                        <span style={{ fontStyle: 'italic', color: COLORS.textLight }}>
                            💡 Click tasks to inspect • Hover for details • Zoom for precision • Use ⬆ to flatten
                            bars • Use 📂+/📂- to expand/collapse levels
                        </span>
                    </div>
                </div>

                {/* Enhanced SVG Gantt with Horizontal Scroll */}
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
                                    const relativeTime = time - minTime; // Calculate relative time from start
                                    const timeLabel = relativeTime.toFixed(2) + 's';
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
                            // Calculate base bar position
                            const baseTaskStartX =
                                labelWidth + timeToX(task.startTime, minTime, pixelsPerUnit, timeScale);
                            const baseTaskEndX =
                                labelWidth + timeToX(task.endTime, minTime, pixelsPerUnit, timeScale);

                            // Apply flattening to bar positions
                            const getAdjustedBarPosition = (
                                task: CustomTask
                            ): { startX: number; endX: number } => {
                                let adjustedStartX = baseTaskStartX;
                                let adjustedEndX = baseTaskEndX;

                                // Build parent map for easier lookup
                                const parentMap = new Map<string, string | undefined>();
                                tasks.forEach(t => {
                                    if (t.parentId) {
                                        parentMap.set(t.id, t.parentId);
                                    } else {
                                        parentMap.set(t.id, undefined);
                                    }
                                });

                                // Find the main task to get the leftmost position
                                const mainTask = tasks.find(t => t.type === 'main');
                                const mainTaskStartX = mainTask
                                    ? labelWidth + timeToX(mainTask.startTime, minTime, pixelsPerUnit, timeScale)
                                    : labelWidth + 10;

                                // Define the flattened position (leftmost position, but not overlapping labels)
                                const minSafePosition = labelWidth + 10; // Ensure 10px padding from label area
                                const flattenedPosition = Math.max(minSafePosition, mainTaskStartX);

                                // Check if this task itself is flattened
                                if (flattenedGroups.has(task.id)) {
                                    const originalDuration = baseTaskEndX - baseTaskStartX;
                                    return { startX: flattenedPosition, endX: flattenedPosition + originalDuration };
                                }

                                // Calculate flattened position for any task
                                const calculateFlattenedPosition = (
                                    taskId: string
                                ): { newStartX: number; found: boolean; isDirectChild: boolean } => {
                                    const currentTask = tasks.find(t => t.id === taskId);
                                    if (!currentTask) return { newStartX: 0, found: false, isDirectChild: false };

                                    const parentId: string | undefined = currentTask.parentId;
                                    if (!parentId) return { newStartX: 0, found: false, isDirectChild: false };

                                    const parentTask = tasks.find(t => t.id === parentId);
                                    if (!parentTask) return { newStartX: 0, found: false, isDirectChild: false };

                                    // If direct parent is flattened
                                    if (flattenedGroups.has(parentId)) {
                                        // Direct children align to the safe flattened position (same as flattened parent)
                                        return { newStartX: flattenedPosition, found: true, isDirectChild: true };
                                    }

                                    // Recursively check if parent has a flattened ancestor
                                    const parentResult = calculateFlattenedPosition(parentId);
                                    if (parentResult.found) {
                                        // Calculate the original relative offset between current task and its direct parent
                                        const currentTaskOriginalStartX =
                                            labelWidth +
                                            timeToX(currentTask.startTime, minTime, pixelsPerUnit, timeScale);
                                        const parentOriginalStartX =
                                            labelWidth + timeToX(parentTask.startTime, minTime, pixelsPerUnit, timeScale);
                                        const originalRelativeOffset = currentTaskOriginalStartX - parentOriginalStartX;

                                        // Parent's new position after flattening
                                        const parentNewStartX = parentResult.newStartX;

                                        // Maintain the same relative offset from the parent's new position
                                        const newStartX = parentNewStartX + originalRelativeOffset;

                                        return { newStartX, found: true, isDirectChild: false };
                                    }

                                    return { newStartX: 0, found: false, isDirectChild: false };
                                };

                                const { newStartX, found, isDirectChild } = calculateFlattenedPosition(task.id);

                                // Apply the new position if we found a flattened ancestor
                                if (found) {
                                    const originalDuration = baseTaskEndX - baseTaskStartX;
                                    adjustedStartX = newStartX;
                                    adjustedEndX = adjustedStartX + originalDuration;
                                }

                                return { startX: adjustedStartX, endX: adjustedEndX };
                            };

                            const { startX: taskStartX, endX: taskEndX } = getAdjustedBarPosition(task);
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
                            } else if (task.isRunning) {
                                gradientId = 'runningGradient';
                                taskColor = COLORS.warning;
                            } else if (isMethod) {
                                gradientId = 'completedGradient';
                                taskColor = task.color || COLORS.info;
                            }

                            const duration = task.endTime - task.startTime; // Already in seconds

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
                                        {/* Tree expand/collapse icon - only show if task has children */}
                                        {(() => {
                                            const hasChildren = tasks.some(t => t.parentId === task.id);
                                            return hasChildren && isCollapsible ? (
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
                                            ) : null;
                                        })()}

                                        {/* Flatten group icon - only show for tasks that have children (except main task) */}
                                        {(() => {
                                            // Check if this task has children by looking for tasks with this task as parent
                                            const hasChildren = tasks.some(t => t.parentId === task.id);

                                            // Only show flatten icon for tasks that actually have children, and exclude main tasks
                                            if (hasChildren && !isMain) {
                                                const hasExpandButton = hasChildren && isCollapsible;
                                                return (
                                                    <g>
                                                        {/* Background circle for flatten icon */}
                                                        <circle
                                                            cx={indent + (hasExpandButton ? 35 : 15)}
                                                            cy={y + currentRowHeight / 2}
                                                            r="8"
                                                            fill={
                                                                flattenedGroups.has(task.id) ? COLORS.accent : COLORS.background
                                                            }
                                                            stroke={COLORS.border}
                                                            strokeWidth="1"
                                                            style={{ cursor: 'pointer' }}
                                                            onClick={e => handleFlattenGroup(task, e)}
                                                        />
                                                        {/* Flatten icon */}
                                                        <text
                                                            x={indent + (hasExpandButton ? 35 : 15)}
                                                            y={y + currentRowHeight / 2 + 3}
                                                            fontSize="8"
                                                            fill={flattenedGroups.has(task.id) ? 'white' : COLORS.text}
                                                            textAnchor="middle"
                                                            dominantBaseline="central"
                                                            style={{ cursor: 'pointer', pointerEvents: 'none' }}
                                                            fontWeight="bold"
                                                        >
                                                            {flattenedGroups.has(task.id) ? '⬅' : '⬆'}
                                                        </text>
                                                    </g>
                                                );
                                            }
                                            return null;
                                        })()}

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
                                            x={
                                                indent +
                                                (() => {
                                                    const hasChildren = tasks.some(t => t.parentId === task.id);
                                                    // Space calculation:
                                                    // - 55px if task has expand button (hasChildren && isCollapsible)
                                                    // - 35px if task has flatten button only (hasChildren but not collapsible, or main/method without children)
                                                    // - 15px if task has no buttons (no children and not main/method)
                                                    if (hasChildren && isCollapsible) return 55; // Has both expand and flatten buttons
                                                    if (hasChildren && !isMain) return 35; // Has flatten button only
                                                    if (isMain || isMethod) return 35; // Main/method tasks get consistent spacing
                                                    return 15; // No buttons, minimal spacing
                                                })()
                                            }
                                            y={y + currentRowHeight / 2}
                                            fontSize={isMain ? '14' : isMethod ? '12' : '11'}
                                            fill={isMain ? COLORS.primary : COLORS.text}
                                            textAnchor="start"
                                            dominantBaseline="central"
                                            fontWeight={isMain ? '700' : isMethod ? '600' : '500'}
                                            style={{
                                                userSelect: 'none',
                                                cursor: (() => {
                                                    const hasChildren = tasks.some(t => t.parentId === task.id);
                                                    return hasChildren && isCollapsible ? 'pointer' : 'default';
                                                })(),
                                            }}
                                            onClick={() => {
                                                const hasChildren = tasks.some(t => t.parentId === task.id);
                                                if (hasChildren && isCollapsible) handleTaskClick(task);
                                            }}
                                        >
                                            {task.name}
                                            {flattenedGroups.has(task.id) && (
                                                <tspan fill={COLORS.accent} fontWeight="bold">
                                                    {' '}
                                                    [FLATTENED]
                                                </tspan>
                                            )}
                                        </text>

                                        {/* Call relationship indicators */}
                                        {task.callers.length > 0 && (
                                            <text
                                                x={
                                                    indent +
                                                    (() => {
                                                        const hasChildren = tasks.some(t => t.parentId === task.id);
                                                        if (hasChildren && isCollapsible) return 55;
                                                        if (hasChildren && !isMain) return 35;
                                                        if (isMain || isMethod) return 35;
                                                        return 15;
                                                    })()
                                                }
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
                                                x={
                                                    indent +
                                                    (() => {
                                                        const hasChildren = tasks.some(t => t.parentId === task.id);
                                                        if (hasChildren && isCollapsible) return 55;
                                                        if (hasChildren && !isMain) return 35;
                                                        if (isMain || isMethod) return 35;
                                                        return 15;
                                                    })()
                                                }
                                                y={y + currentRowHeight / 2 + (task.callers.length > 0 ? 14 : 8)}
                                                fontSize="8"
                                                fill={COLORS.textLight}
                                                textAnchor="start"
                                                dominantBaseline="central"
                                                fontWeight="400"
                                            >
                                                ⏱️ {duration.toFixed(3)}s {task.isRunning ? '🔄' : ''}
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
                                        {task.isRunning && (
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

                        const duration = task.endTime - task.startTime; // Already in seconds
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
