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

// Enhanced task interface with grouping support
interface CustomTask {
    id: string;
    name: string;
    startTime: number;
    endTime: number;
    progress: number;
    type: 'main' | 'group' | 'completed' | 'running';
    serviceName?: string;
    groupId?: string;
    level: number; // 0 = root, 1 = group, 2 = task
    isCollapsed?: boolean;
    children?: CustomTask[];
    dependencies?: string[];
    color?: string;
}

// Group structure
interface TaskGroup {
    id: string;
    name: string;
    tasks: CustomTask[];
    isCollapsed: boolean;
    color: string;
    startTime: number;
    endTime: number;
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
    grid: '#f1f5f9'
};

// Caller group colors for dependency-based grouping
const CALLER_COLORS = [
    '#6366f1', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b',
    '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#f97316'
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
        const [groups, setGroups] = useState<TaskGroup[]>([]);
        const [timeScale, setTimeScale] = useState<TimeScale>('seconds');
        const [zoomLevel, setZoomLevel] = useState(1);
        const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
        const [hoveredTask, setHoveredTask] = useState<string | null>(null);

        // Chart dimensions
        const chartHeight = 500;
        const rowHeight = 40;
        const groupRowHeight = 45;
        const labelWidth = 280;
        const timelineHeight = 50;

        // Transform flameData to grouped tasks
        const transformFlameDataToGroupedTasks = (data: FlameGraphData): { tasks: CustomTask[], groups: TaskGroup[] } => {
            if (!data || !data.aggregated || !Array.isArray(data.aggregated)) {
                console.warn('Invalid flame graph data format:', data);
                return { tasks: [], groups: [] };
            }

            const customTasks: CustomTask[] = [];
            const taskGroups: TaskGroup[] = [];
            const callerGroupMap = new Map<string, TaskGroup>();
            const dependencyMap = new Map<string, string[]>(); // callee -> callers
            let taskIdCounter = 0;

            // Helper function to format display name
            const formatDisplayName = (name: string): string => {
                if (name === '_main') return 'Main Execution Flow';

                const match = name.match(/^(.+?):(.+?)\.(.+)$/);
                if (match) {
                    const [_, serviceName, _instanceId, func] = match;
                    return func;
                }
                return name;
            };

            // Helper function to extract function name from full path
            const extractFunctionName = (name: string): string => {
                const match = name.match(/^(.+?):(.+?)\.(.+)$/);
                if (match) {
                    return match[3]; // Just the function name
                }
                return name.split('.').pop() || name;
            };

            // Collect all timing data for main task calculation
            const allStartTimes: number[] = [];
            const allEndTimes: number[] = [];

            // First pass: Build dependency relationships from parentStartTimes
            if (data.parentStartTimes) {
                data.parentStartTimes.forEach(({ calleeId, startTimes }) => {
                    startTimes.forEach(({ callerId }) => {
                        if (callerId) {
                            if (!dependencyMap.has(calleeId)) {
                                dependencyMap.set(calleeId, []);
                            }
                            dependencyMap.get(calleeId)!.push(callerId);
                        }
                    });
                });
            }

            // Process completed tasks and group by calling dependencies
            data.aggregated.forEach((node, nodeIndex) => {
                if (node.totalInParent && node.totalInParent.length > 0) {
                    node.totalInParent.forEach(entry => {
                        if (entry.startTime > 0 && entry.duration > 0) {
                            const startTime = entry.startTime;
                            const endTime = startTime + (entry.duration * 1000);

                            allStartTimes.push(startTime);
                            allEndTimes.push(endTime);

                            // Determine caller group for this task
                            const callers = dependencyMap.get(node.name) || [];
                            const primaryCaller = callers.length > 0 ? callers[0] : 'Root';
                            const callerDisplayName = primaryCaller === 'Root' ? 'Root Functions' : formatDisplayName(primaryCaller);

                            // Get or create caller group
                            if (!callerGroupMap.has(primaryCaller)) {
                                const groupColor = CALLER_COLORS[callerGroupMap.size % CALLER_COLORS.length];
                                const group: TaskGroup = {
                                    id: `group-${primaryCaller}`,
                                    name: `Called by: ${callerDisplayName}`,
                                    tasks: [],
                                    isCollapsed: false,
                                    color: groupColor,
                                    startTime: startTime,
                                    endTime: endTime
                                };
                                callerGroupMap.set(primaryCaller, group);
                                taskGroups.push(group);
                            }

                            const group = callerGroupMap.get(primaryCaller)!;
                            group.startTime = Math.min(group.startTime, startTime);
                            group.endTime = Math.max(group.endTime, endTime);

                            const task: CustomTask = {
                                id: `task-${taskIdCounter++}`,
                                name: formatDisplayName(node.name),
                                startTime: startTime,
                                endTime: endTime,
                                progress: 100,
                                type: 'completed',
                                groupId: group.id,
                                level: 2,
                                color: group.color,
                                dependencies: callers
                            };

                            group.tasks.push(task);
                            customTasks.push(task);
                        }
                    });
                }
            });

            // Process running tasks
            if (data.parentStartTimes) {
                data.parentStartTimes.forEach(({ calleeId, startTimes }) => {
                    startTimes.forEach(({ startTime, callerId }) => {
                        if (startTime > 0 && startTime < currentTimestamp) {
                            allStartTimes.push(startTime);
                            allEndTimes.push(currentTimestamp);

                            // Determine caller group for this running task
                            const callers = callerId ? [callerId] : dependencyMap.get(calleeId) || [];
                            const primaryCaller = callers.length > 0 ? callers[0] : 'Root';
                            const callerDisplayName = primaryCaller === 'Root' ? 'Root Functions' : formatDisplayName(primaryCaller);

                            // Get or create caller group
                            if (!callerGroupMap.has(primaryCaller)) {
                                const groupColor = CALLER_COLORS[callerGroupMap.size % CALLER_COLORS.length];
                                const group: TaskGroup = {
                                    id: `group-${primaryCaller}`,
                                    name: `Called by: ${callerDisplayName}`,
                                    tasks: [],
                                    isCollapsed: false,
                                    color: groupColor,
                                    startTime: startTime,
                                    endTime: currentTimestamp
                                };
                                callerGroupMap.set(primaryCaller, group);
                                taskGroups.push(group);
                            }

                            const group = callerGroupMap.get(primaryCaller)!;
                            group.startTime = Math.min(group.startTime, startTime);
                            group.endTime = Math.max(group.endTime, currentTimestamp);

                            const task: CustomTask = {
                                id: `running-${taskIdCounter++}`,
                                name: `${formatDisplayName(calleeId)}`,
                                startTime: startTime,
                                endTime: currentTimestamp,
                                progress: 100,
                                type: 'running',
                                groupId: group.id,
                                level: 2,
                                color: group.color,
                                dependencies: callers
                            };

                            group.tasks.push(task);
                            customTasks.push(task);
                        }
                    });
                });
            }

            // Create main task if we have timing data
            if (allStartTimes.length > 0 && allEndTimes.length > 0) {
                const mainStartTime = Math.min(...allStartTimes);
                const mainEndTime = Math.max(...allEndTimes);

                const mainTask: CustomTask = {
                    id: 'main-task',
                    name: 'Main Execution Flow',
                    startTime: mainStartTime,
                    endTime: mainEndTime,
                    progress: 100,
                    type: 'main',
                    level: 0,
                    color: COLORS.primary
                };

                customTasks.unshift(mainTask);
            }

            // Sort groups and tasks by start time
            taskGroups.sort((a, b) => a.startTime - b.startTime);
            taskGroups.forEach(group => {
                group.tasks.sort((a, b) => a.startTime - b.startTime);
            });

            console.log(`Created ${customTasks.length} tasks in ${taskGroups.length} groups`);
            return { tasks: customTasks, groups: taskGroups };
        };

        // Get visible tasks based on collapsed groups
        const getVisibleTasks = (): CustomTask[] => {
            const visibleTasks: CustomTask[] = [];

            // Add main task
            const mainTask = tasks.find(t => t.type === 'main');
            if (mainTask) visibleTasks.push(mainTask);

            // Add group headers and their tasks
            groups.forEach(group => {
                // Add group header task
                const groupTask: CustomTask = {
                    id: group.id,
                    name: `${group.name} (${group.tasks.length} tasks)`,
                    startTime: group.startTime,
                    endTime: group.endTime,
                    progress: Math.round(group.tasks.reduce((acc, t) => acc + t.progress, 0) / group.tasks.length),
                    type: 'group',
                    level: 1,
                    isCollapsed: collapsedGroups.has(group.id),
                    color: group.color
                };
                visibleTasks.push(groupTask);

                // Add group tasks if not collapsed
                if (!collapsedGroups.has(group.id)) {
                    visibleTasks.push(...group.tasks);
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
        const timeToX = (time: number, minTime: number, pixelsPerUnit: number, scale: TimeScale): number => {
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
            if (task.type === 'group') {
                // Toggle group collapse
                const newCollapsed = new Set(collapsedGroups);
                if (newCollapsed.has(task.id)) {
                    newCollapsed.delete(task.id);
                } else {
                    newCollapsed.add(task.id);
                }
                setCollapsedGroups(newCollapsed);
                return;
            }

            if (task.type === 'main') return;

            const taskName = task.name;
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
                const method = graphData.methods.find(m =>
                    taskName.includes(m.name) || m.name.includes(taskName.split('.').pop() || '')
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
        };

        // Update tasks when flameData changes
        useEffect(() => {
            if (flameData) {
                const { tasks: newTasks, groups: newGroups } = transformFlameDataToGroupedTasks(flameData);
                setTasks(newTasks);
                setGroups(newGroups);
            }
        }, [flameData, currentTimestamp]);

        // Filter tasks based on search term
        const visibleTasks = getVisibleTasks();
        const filteredTasks = searchTerm && searchTerm.trim() !== ''
            ? visibleTasks.filter(task =>
                task.name.toLowerCase().includes(searchTerm.toLowerCase())
            )
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
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
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

        const { minTime, maxTime, pixelsPerUnit, unitLabel } = getTimeScaleInfo(filteredTasks, timeScale);
        const chartWidth = Math.max(1200, timeToX(maxTime, minTime, pixelsPerUnit, timeScale) + 200);

        // Calculate total height with proper spacing for each task type
        let totalHeight = timelineHeight + 60;
        filteredTasks.forEach(task => {
            totalHeight += task.type === 'group' ? groupRowHeight : rowHeight;
        });

        // Generate timeline ticks
        const generateTimelineTicks = () => {
            const ticks = [];
            const totalDuration = maxTime - minTime;
            let tickInterval: number;

            switch (timeScale) {
                case 'milliseconds':
                    tickInterval = Math.max(1, Math.round(totalDuration / 15));
                    break;
                case 'seconds':
                    tickInterval = Math.max(100, Math.round((totalDuration / 1000) / 15) * 1000);
                    break;
                case 'minutes':
                    tickInterval = Math.max(5000, Math.round((totalDuration / 60000) / 15) * 60000);
                    break;
                case 'hours':
                    tickInterval = Math.max(300000, Math.round((totalDuration / 3600000) / 15) * 3600000);
                    break;
                default:
                    tickInterval = 1000;
            }

            for (let time = minTime; time <= maxTime; time += tickInterval) {
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
                    fontFamily: '"Inter", "Segoe UI", "Roboto", sans-serif'
                }}
            >
                {/* Controls and Info */}
                <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', color: COLORS.textLight, fontWeight: '500' }}>
                                {filteredTasks.length} tasks • {groups.length} groups
                            </span>
                        </div>
                    </div>

                    {/* Controls Row */}
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <span style={{ fontWeight: '600', fontSize: '14px', color: COLORS.text }}>Time Scale:</span>
                            {(['milliseconds', 'seconds', 'minutes', 'hours'] as TimeScale[]).map((scale) => (
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
                                        boxShadow: timeScale === scale ? '0 4px 6px -1px rgba(99, 102, 241, 0.2)' : 'none'
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
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                🔍-
                            </button>
                            <span style={{
                                fontSize: '13px',
                                color: COLORS.textLight,
                                fontWeight: '600',
                                minWidth: '60px',
                                textAlign: 'center'
                            }}>
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
                                    transition: 'all 0.2s ease'
                                }}
                            >
                                🔍+
                            </button>
                        </div>

                        <div style={{
                            padding: '8px 12px',
                            backgroundColor: COLORS.background,
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: COLORS.textLight,
                            fontWeight: '500'
                        }}>
                            Duration: {formatTime(maxTime, minTime, timeScale)} • Scale: {unitLabel}
                        </div>
                    </div>

                    {/* Modern Legend */}
                    <div style={{
                        display: 'flex',
                        gap: '20px',
                        fontSize: '12px',
                        color: COLORS.textLight,
                        flexWrap: 'wrap',
                        padding: '12px',
                        backgroundColor: COLORS.background,
                        borderRadius: '8px',
                        border: `1px solid ${COLORS.border}`
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '16px',
                                height: '12px',
                                background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.secondary})`,
                                borderRadius: '3px',
                                boxShadow: '0 2px 4px rgba(99, 102, 241, 0.2)'
                            }}></div>
                            <span style={{ fontWeight: '500' }}>Main Flow</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '16px',
                                height: '12px',
                                backgroundColor: COLORS.info,
                                borderRadius: '3px',
                                boxShadow: '0 2px 4px rgba(59, 130, 246, 0.2)'
                            }}></div>
                            <span style={{ fontWeight: '500' }}>Caller Groups (click to expand/collapse)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '16px',
                                height: '12px',
                                backgroundColor: COLORS.success,
                                borderRadius: '3px',
                                boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)'
                            }}></div>
                            <span style={{ fontWeight: '500' }}>Completed Tasks</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                                width: '16px',
                                height: '12px',
                                backgroundColor: COLORS.warning,
                                borderRadius: '3px',
                                boxShadow: '0 2px 4px rgba(245, 158, 11, 0.2)'
                            }}></div>
                            <span style={{ fontWeight: '500' }}>Running Tasks</span>
                        </div>
                        <span style={{ fontStyle: 'italic', color: COLORS.textLight }}>
                            💡 Click tasks to inspect • Hover for details • Zoom for precision
                        </span>
                    </div>
                </div>

                {/* Enhanced SVG Gantt Chart with Horizontal Scroll */}
                <div style={{
                    backgroundColor: COLORS.surface,
                    borderRadius: '12px',
                    border: `1px solid ${COLORS.border}`,
                    overflow: 'auto',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    maxHeight: '500px',
                    width: '100%'
                }}>
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

                        {/* Enhanced Task Rows */}
                        {filteredTasks.map((task, index) => {
                            // Calculate y position with proper spacing for different row heights
                            let y = timelineHeight + 20;
                            for (let i = 0; i < index; i++) {
                                y += filteredTasks[i].type === 'group' ? groupRowHeight : rowHeight;
                            }
                            const taskStartX = labelWidth + timeToX(task.startTime, minTime, pixelsPerUnit, timeScale);
                            const taskEndX = labelWidth + timeToX(task.endTime, minTime, pixelsPerUnit, timeScale);
                            const taskWidth = Math.max(3, taskEndX - taskStartX);

                            const isGroup = task.type === 'group';
                            const isMain = task.type === 'main';
                            const isHovered = hoveredTask === task.id;
                            const isSelected = selectedElementId === task.id;

                            const currentRowHeight = isGroup ? groupRowHeight : rowHeight;
                            const barHeight = currentRowHeight - 10;

                            let taskColor = task.color || COLORS.neutral;
                            let gradientId = 'completedGradient';

                            if (isMain) {
                                gradientId = 'mainGradient';
                            } else if (task.type === 'running') {
                                gradientId = 'runningGradient';
                            } else if (isGroup) {
                                taskColor = task.color || COLORS.info;
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
                                        fill={isSelected ? '#f0f9ff' : (index % 2 === 0 ? COLORS.surface : COLORS.background)}
                                        stroke={isSelected ? COLORS.info : 'transparent'}
                                        strokeWidth={isSelected ? 2 : 0}
                                        rx={isSelected ? 8 : 0}
                                        opacity={isHovered ? 0.8 : 1}
                                        style={{ transition: 'all 0.2s ease' }}
                                    />

                                    {/* Task Label with Enhanced Typography */}
                                    <g>
                                        {/* Group expand/collapse icon */}
                                        {isGroup && (
                                            <text
                                                x={15}
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

                                        {/* Task name */}
                                        <text
                                            x={isGroup ? 35 : 15}
                                            y={y + currentRowHeight / 2 - 2}
                                            fontSize={isMain ? "14" : isGroup ? "13" : "12"}
                                            fill={isMain ? COLORS.primary : COLORS.text}
                                            textAnchor="start"
                                            fontWeight={isMain ? "700" : isGroup ? "600" : "500"}
                                            style={{
                                                userSelect: 'none',
                                                cursor: isGroup ? 'pointer' : 'default'
                                            }}
                                            onClick={() => isGroup && handleTaskClick(task)}
                                        >
                                            {task.name}
                                        </text>

                                        {/* Duration subtitle */}
                                        <text
                                            x={isGroup ? 35 : 15}
                                            y={y + currentRowHeight / 2 + 12}
                                            fontSize="10"
                                            fill={COLORS.textLight}
                                            textAnchor="start"
                                            fontWeight="400"
                                        >
                                            {duration.toFixed(3)}s • {task.progress}%
                                        </text>
                                    </g>

                                    {/* Enhanced Task Bar */}
                                    <g
                                        style={{ cursor: isGroup ? 'pointer' : 'default' }}
                                        onMouseEnter={() => setHoveredTask(task.id)}
                                        onMouseLeave={() => setHoveredTask(null)}
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
                                            y={y + 5}
                                            width={taskWidth}
                                            height={barHeight}
                                            fill={isMain || isGroup ? `url(#${gradientId})` : (task.type === 'running' ? `url(#${gradientId})` : `url(#${gradientId})`)}
                                            stroke={isHovered ? 'white' : taskColor}
                                            strokeWidth={isHovered ? 3 : 1}
                                            rx={6}
                                            opacity={isHovered ? 0.9 : 0.85}
                                            filter="url(#dropShadow)"
                                            style={{ transition: 'all 0.2s ease' }}
                                        />

                                        {/* Running task indicator */}
                                        {task.type === 'running' && (
                                            <rect
                                                x={taskStartX + 2}
                                                y={y + 7}
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
                                                    pointerEvents: 'none'
                                                }}
                                            >
                                                {duration.toFixed(2)}s
                                            </text>
                                        )}

                                        {/* Hover tooltip background */}
                                        {isHovered && (
                                            <g>
                                                <rect
                                                    x={taskStartX + taskWidth + 10}
                                                    y={y - 10}
                                                    width={160}
                                                    height={50}
                                                    fill={COLORS.text}
                                                    stroke={COLORS.border}
                                                    strokeWidth={1}
                                                    rx={8}
                                                    opacity={0.95}
                                                    filter="url(#dropShadow)"
                                                />
                                                <text
                                                    x={taskStartX + taskWidth + 20}
                                                    y={y + 5}
                                                    fontSize="11"
                                                    fill="white"
                                                    fontWeight="600"
                                                >
                                                    {task.name}
                                                </text>
                                                <text
                                                    x={taskStartX + taskWidth + 20}
                                                    y={y + 20}
                                                    fontSize="10"
                                                    fill="rgba(255,255,255,0.8)"
                                                >
                                                    Duration: {duration.toFixed(3)}s
                                                </text>
                                                <text
                                                    x={taskStartX + taskWidth + 20}
                                                    y={y + 32}
                                                    fontSize="10"
                                                    fill="rgba(255,255,255,0.8)"
                                                >
                                                    Progress: {task.progress}% • {task.type}
                                                </text>
                                            </g>
                                        )}
                                    </g>
                                </g>
                            );
                        })}
                    </svg>
                </div>
            </div>
        );
    }
);

export default GanttVisualization; 