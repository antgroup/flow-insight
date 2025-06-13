import {
  Box,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Button,
  Menu,
  MenuItem,
  Typography,
  Divider,
  TextField,
  InputAdornment,
  CircularProgress,
  Popover,
} from '@mui/material';
import { Download, RefreshCw, PanelLeft, PanelRight, Bug, Clock, FileText } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import InsightPanel from './Analysis';
import DebugPanel from './DebugPanel';
import ElementsPanel from './ElementsPanel';
import FlameVisualization, { FlameVisualizationHandle } from './Flame';
import GanttVisualization, { GanttVisualizationHandle } from './Gantt';
import InfoCard from './InfoCard';
import PhysicalVisualization, { PhysicalVisualizationHandle } from './Physical';
import Visualization, { colorScheme, VisualizationHandle } from './Visualization';
import { ApiService } from '../services/api';
import {
  GraphData,
  Service,
  Method,
  FunctionNode,
  PhysicalViewData,
  FlameGraphData,
  FlameTreeNode,
} from '../types';

type ElementData = Service | Method | FunctionNode;

type RouteParams = Record<string, string | undefined>;

// Define GraphPage props interface
type GraphPageProps = {
  graphData?: GraphData;
  stackGraphData?: GraphData | null;
  physicalViewData?: PhysicalViewData | null;
  flameData?: FlameGraphData | null;
  flowId?: string;
  initialViewType?: 'logical' | 'call_stack' | 'physical' | 'flame' | 'gantt' | 'analysis';
  autoRefresh?: boolean;
  onElementClick?: (data: ElementData, skip_zoom?: boolean) => void;
  selectedElementId?: string | null;
  onUpdate?: () => Promise<void>;
  colorScheme?: Record<string, string>;
  apiService: ApiService;
};

const GraphPage: React.FC<GraphPageProps> = ({
  graphData: initialGraphData,
  stackGraphData: initialStackGraphData,
  physicalViewData: initialPhysicalViewData,
  flameData: initialFlameData,
  flowId: propFlowId,
  initialViewType = 'logical',
  autoRefresh: initialAutoRefresh = false,
  selectedElementId: initialSelectedElementId,
  colorScheme: customColorScheme,
  apiService,
}) => {
  const { flowId: routeFlowId } = useParams<RouteParams>();
  const [graphData, setGraphData] = useState<GraphData | null>(initialGraphData || null);
  const [stackGraphData, setStackGraphData] = useState<GraphData | null>(
    initialStackGraphData || null
  );
  const [physicalViewData, setPhysicalViewData] = useState<PhysicalViewData | null>(
    initialPhysicalViewData || null
  );
  const [flameData, setFlameData] = useState<FlameGraphData | null>(initialFlameData || null);
  const [error, setError] = useState<string | null>(null);
  const [currentFlowId, setCurrentFlowId] = useState<string | undefined>(propFlowId || routeFlowId);
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh);
  const [currentViewType, setCurrentViewType] = useState<
    'logical' | 'call_stack' | 'physical' | 'flame' | 'gantt' | 'analysis'
  >(initialViewType || 'logical');
  const visualizationRef = useRef<VisualizationHandle>(null);
  const physicalVisualizationRef = useRef<PhysicalVisualizationHandle>(null);
  const flameVisualizationRef = useRef<FlameVisualizationHandle>(null);
  const ganttVisualizationRef = useRef<GanttVisualizationHandle>(null);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [updating, setUpdating] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // State for drawer visibility
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(true);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(true);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);

  // Snapshot-based time travel
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>('latest');
  const [currentTimestamp, setCurrentTimestamp] = useState<number>(Date.now());
  const [isLatestTime, setIsLatestTime] = useState<boolean>(true);

  // State management similar to App.tsx
  const [infoCardData, setInfoCardData] = useState<ElementData>({
    id: 'default',
    type: 'function',
    name: 'Component Details',
  });

  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    initialSelectedElementId || null
  );

  const [flowDuration, setFlowDuration] = useState<number | null>(null);

  // Time selector state
  const [timeMenuAnchorEl, setTimeMenuAnchorEl] = useState<null | HTMLElement>(null);
  const timeMenuOpen = Boolean(timeMenuAnchorEl);

  const fetchSnapshots = useCallback(
    async (flowId?: string) => {
      if (!flowId) return;

      try {
        const snapshotList = await apiService.listSnapshots(flowId);
        setSnapshots(snapshotList);
      } catch (err) {
        console.error('Failed to fetch snapshots:', err);
      }
    },
    [apiService]
  );

  // Helper function to convert snapshot label to timestamp
  const getTimestampFromSnapshot = useCallback(
    (snapshotLabel?: string): number | undefined => {
      if (!snapshotLabel || snapshotLabel === 'latest') {
        return undefined;
      }
      const snapshotObj = snapshots.find(s => s.label === snapshotLabel);
      return snapshotObj ? snapshotObj.timestamp : undefined;
    },
    [snapshots]
  );

  const fetchGraphData = useCallback(
    async (id?: string, stackMode?: boolean, snapshot?: string) => {
      if (!id) {
        return;
      }

      try {
        const timestamp = getTimestampFromSnapshot(snapshot);
        const graphData = await apiService.getGraphData(id, stackMode, timestamp);

        if (graphData) {
          if (stackMode) {
            setStackGraphData(graphData);
          } else {
            setGraphData(graphData);
          }
          setError(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch graph data');
      }
    },
    [apiService, getTimestampFromSnapshot]
  );

  // Update currentFlowId when route FlowId changes
  useEffect(() => {
    if (routeFlowId) {
      setCurrentFlowId(routeFlowId);
    }
  }, [routeFlowId]);

  // Removed useEffect that was causing page reloads

  // Update the current timestamp periodically if auto-refresh is enabled and latest snapshot is selected
  useEffect(() => {
    if (autoRefresh && selectedSnapshot === 'latest') {
      const intervalId = setInterval(() => {
        const now = Date.now();
        // Only update timestamp when auto-refresh is enabled AND latest snapshot is selected
        setCurrentTimestamp(now);
        // Ensure isLatestTime remains true during auto-refresh
        setIsLatestTime(true);
      }, 5000);

      return () => {
        clearInterval(intervalId);
      };
    }
  }, [autoRefresh, selectedSnapshot]);

  // Initial data fetch - only when component mounts or flowId changes
  useEffect(() => {
    if (currentFlowId && initialLoading) {
      (async () => {
        try {
          await fetchGraphData(currentFlowId, false);
          await fetchGraphData(currentFlowId, true);
          const data = await apiService.getPhysicalViewData(currentFlowId);
          setPhysicalViewData(data);
          const flameData = await apiService.getFlameGraphData(currentFlowId);
          setFlameData(flameData);

          // Also fetch flow creation time and initial snapshots
          try {
            const creationTime = await apiService.getFlowCreationTime(currentFlowId);
            const now = Date.now();
            setCurrentTimestamp(now);
            setFlowDuration(now - creationTime);

            // Fetch snapshots for this flow
            await fetchSnapshots(currentFlowId);
          } catch (err) {
            console.error('Failed to fetch flow creation time or snapshots:', err);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch view data');
        } finally {
          setInitialLoading(false);
        }
      })();
    }
  }, [currentFlowId, initialLoading]); // Only depend on flowId and initialLoading flag

  const fetchDatas = async (snapshot?: string, showLoading = true, viewType?: string) => {
    const useSnapshot = snapshot !== undefined ? snapshot : selectedSnapshot;
    const targetViewType = viewType || currentViewType;

    try {
      if (showLoading) {
        setUpdating(true);
      }

      if (targetViewType === 'call_stack') {
        await fetchGraphData(currentFlowId, true, useSnapshot);
      }
      if (targetViewType === 'logical') {
        await fetchGraphData(currentFlowId, false, useSnapshot);
      }
      if (targetViewType === 'physical') {
        await fetchGraphData(currentFlowId, false, useSnapshot);
        try {
          const timestamp = getTimestampFromSnapshot(useSnapshot);
          const data = await apiService.getPhysicalViewData(currentFlowId!, timestamp);
          setPhysicalViewData(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch physical view data');
        }
      }
      if (
        targetViewType === 'flame' ||
        targetViewType === 'gantt' ||
        targetViewType === 'analysis'
      ) {
        await fetchGraphData(currentFlowId, false, useSnapshot);
        try {
          const timestamp = getTimestampFromSnapshot(useSnapshot);
          const data = await apiService.getPhysicalViewData(currentFlowId!, timestamp);
          setPhysicalViewData(data);
          const flameData = await apiService.getFlameGraphData(currentFlowId!, timestamp);
          setFlameData(flameData);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch view data');
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to fetch data');
    } finally {
      if (showLoading) {
        setUpdating(false);
      }
    }
  };
  // Simplified auto-refresh without problematic dependencies
  useEffect(() => {
    if (autoRefresh && selectedSnapshot === 'latest') {
      const intervalId = setInterval(async () => {
        await fetchDatas('latest', false);
      }, 2000);

      autoRefreshIntervalRef.current = intervalId;

      return () => {
        if (autoRefreshIntervalRef.current) {
          clearInterval(autoRefreshIntervalRef.current);
          autoRefreshIntervalRef.current = null;
        }
      };
    } else if (autoRefreshIntervalRef.current) {
      clearInterval(autoRefreshIntervalRef.current);
      autoRefreshIntervalRef.current = null;
    }
  }, [autoRefresh, selectedSnapshot]); // Removed problematic dependencies

  const handleElementClick = useCallback((data: ElementData, skip_zoom = false) => {
    setInfoCardData({ ...data });
    if (skip_zoom) {
      return;
    }

    if (data && data.id) {
      setSelectedElementId(data.id);
    }
  }, []);

  const handleUpdate = useCallback(async () => {
    // Always get latest data when manually updating
    const now = Date.now();
    setCurrentTimestamp(now);
    setIsLatestTime(true);
    setSelectedSnapshot('latest');

    await fetchDatas('latest', false);
  }, [fetchDatas]);

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const handleViewTypeChange = useCallback(
    async (viewType: 'logical' | 'call_stack' | 'physical' | 'flame' | 'gantt' | 'analysis') => {
      // First change to the new view type
      setCurrentViewType(viewType);

      // Then fetch data for this view type with the current snapshot, passing the viewType explicitly
      await fetchDatas(selectedSnapshot, true, viewType);
    },
    [fetchDatas, selectedSnapshot]
  );

  // Handle snapshot menu open
  const handleTimeMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setTimeMenuAnchorEl(event.currentTarget);

    // Only refresh snapshots if we don't have any yet, don't force refresh to avoid state reset
    if (currentFlowId && snapshots.length === 0) {
      fetchSnapshots(currentFlowId);
    }
  };

  // Handle snapshot menu close - completely prevent unwanted closing
  const handleTimeMenuClose = (event?: any, reason?: 'backdropClick' | 'escapeKeyDown') => {
    // Only close on backdrop click or escape key
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      setTimeMenuAnchorEl(null);
    }
    // Prevent any other reasons from closing the menu
  };

  // Handle snapshot selection (internal - doesn't close menu)
  const selectSnapshot = (snapshotLabel: string) => {
    setSelectedSnapshot(snapshotLabel);
    setIsLatestTime(snapshotLabel === 'latest');

    // Update current timestamp based on selected snapshot
    if (snapshotLabel === 'latest') {
      setCurrentTimestamp(Date.now());
    } else {
      const snapshot = snapshots.find(s => s.label === snapshotLabel);
      if (snapshot) {
        setCurrentTimestamp(snapshot.timestamp);
      }
    }

    // Fetch data without showing loading indicators to prevent page blinking
    fetchDatas(snapshotLabel, false);
  };

  // Handle explicit user snapshot selection (keeps menu open)
  const handleSnapshotSelect = (snapshotLabel: string) => {
    selectSnapshot(snapshotLabel);
    // Keep menu open for all snapshot selections
  };

  // Handle quick time selection (e.g., "5m ago", "1h ago")
  const handleQuickTimeSelect = (minutesAgo: number) => {
    const targetTime = Date.now() - minutesAgo * 60 * 1000;
    selectClosestSnapshot(targetTime);
    // Keep menu open for quick time selection
  };

  // Handle custom time selection from datetime input
  const handleCustomTimeSelect = (dateTimeValue: string) => {
    if (dateTimeValue) {
      const targetTime = new Date(dateTimeValue).getTime();
      selectClosestSnapshot(targetTime);
      // Keep menu open for custom time selection
    }
  };

  // Find and select the closest snapshot to a target time
  const selectClosestSnapshot = (targetTime: number) => {
    if (snapshots.length === 0) {
      return;
    }

    // Find the snapshot closest to the target time
    let closestSnapshot = snapshots[0];
    let minDiff = Math.abs(targetTime - snapshots[0].timestamp);

    for (const snapshot of snapshots) {
      const diff = Math.abs(targetTime - snapshot.timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestSnapshot = snapshot;
      }
    }

    // If target time is very recent (within 30 seconds), use latest
    if (Math.abs(targetTime - Date.now()) < 30000) {
      selectSnapshot('latest');
    } else {
      selectSnapshot(closestSnapshot.label);
    }
  };

  // Navigation between snapshots
  const handlePreviousSnapshot = () => {
    // Left arrow = go to earlier (older) time
    const currentIndex = snapshots.findIndex(s => s.label === selectedSnapshot);
    if (selectedSnapshot === 'latest' && snapshots.length > 0) {
      selectSnapshot(snapshots[0].label);
    } else if (currentIndex >= 0 && currentIndex < snapshots.length - 1) {
      selectSnapshot(snapshots[currentIndex + 1].label);
    }
  };

  const handleNextSnapshot = () => {
    // Right arrow = go to later (newer) time
    const currentIndex = snapshots.findIndex(s => s.label === selectedSnapshot);
    if (currentIndex > 0) {
      selectSnapshot(snapshots[currentIndex - 1].label);
    } else if (currentIndex === 0) {
      selectSnapshot('latest');
    }
  };

  const canGoPreviousSnapshot = () => {
    // Can go to earlier (left arrow) if we're not at the oldest snapshot
    if (selectedSnapshot === 'latest') {
      return snapshots.length > 0;
    }
    const currentIndex = snapshots.findIndex(s => s.label === selectedSnapshot);
    return currentIndex >= 0 && currentIndex < snapshots.length - 1;
  };

  const canGoNextSnapshot = () => {
    // Can go to later (right arrow) if we're not at latest
    if (selectedSnapshot === 'latest') {
      return false;
    }
    const currentIndex = snapshots.findIndex(s => s.label === selectedSnapshot);
    return currentIndex > 0 || currentIndex === 0; // Can always go from any snapshot back to latest
  };

  const getCurrentSnapshotIndex = () => {
    if (selectedSnapshot === 'latest') {
      return 1; // Latest is position 1
    }
    const currentIndex = snapshots.findIndex(s => s.label === selectedSnapshot);
    return currentIndex >= 0 ? currentIndex + 2 : 1; // +2 because: latest(1) + snapshot_index + 1
  };

  // Format timestamp for datetime-local input
  const formatDateTimeForInput = (timestamp: number) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const handleAutoRefreshChange = useCallback(
    (enabled: boolean) => {
      setAutoRefresh(enabled);

      // When enabling auto-refresh, automatically switch to latest snapshot
      if (enabled) {
        const now = Date.now();
        setCurrentTimestamp(now);
        setIsLatestTime(true);
        setSelectedSnapshot('latest');
        // Fetch latest data
        fetchDatas('latest', false);
      }
    },
    [fetchDatas]
  );

  // Handle setting current time to now
  const handleSetToNow = () => {
    const now = Date.now();
    setCurrentTimestamp(now);
    setIsLatestTime(true);
    setSelectedSnapshot('latest');
    fetchDatas('latest');
  };

  // Toggle drawer states
  const toggleLeftDrawer = () => {
    setLeftDrawerOpen(!leftDrawerOpen);
  };

  const toggleRightDrawer = () => {
    setRightDrawerOpen(!rightDrawerOpen);
  };

  const toggleDebugPanel = () => {
    setDebugPanelOpen(!debugPanelOpen);
  };

  // Function to handle SVG export based on current view type
  const handleExportSvg = () => {
    switch (currentViewType) {
      case 'logical':
      case 'call_stack':
        visualizationRef.current?.exportSvg();
        break;
      case 'physical':
        physicalVisualizationRef.current?.exportSvg();
        break;
      case 'flame':
        flameVisualizationRef.current?.exportSvg();
        break;
      case 'gantt':
        ganttVisualizationRef.current?.exportSvg();
        break;
      case 'analysis':
        // Export analysis report via global function set by Analysis component
        if (window.exportAnalysisReport && typeof window.exportAnalysisReport === 'function') {
          window.exportAnalysisReport();
        } else {
          console.warn('Export not supported for analysis view - exportAnalysisReport not found');
        }
        break;
      default:
        console.warn('Export not supported for this view type');
    }
  };

  // Function to export flame graph data as Chrome tracing JSON
  const handleExportChromeTracing = () => {
    if (!flameData) {
      console.warn('No flame data available for export');
      return;
    }

    try {
      // Convert flame graph data to Chrome tracing format
      const chromeTracingData = convertFlameDataToChromeTracing(flameData);

      // Create and download the JSON file
      const jsonString = JSON.stringify(chromeTracingData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `flow-insight-trace-${currentFlowId || 'unknown'}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();

      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export Chrome tracing data:', error);
    }
  };

  // Convert FlameGraphData to Chrome tracing format
  const convertFlameDataToChromeTracing = (data: FlameGraphData) => {
    const events: any[] = [];
    let eventId = 0;

    // Helper function to convert timestamp to microseconds
    const toMicroseconds = (timestamp: number) => timestamp * 1000;

    if (!data || !data.root) {
      return {
        traceEvents: [],
        displayTimeUnit: 'ms',
        systemTraceEvents: [],
        otherData: {},
      };
    }

    // Get unique service names from the tree
    const serviceNames = new Set<string>();
    const collectServiceNames = (node: FlameTreeNode) => {
      const serviceName = node.id.includes(':') ? node.id.split(':')[0] : 'Unknown';
      serviceNames.add(serviceName);
      if (node.children) {
        node.children.forEach(collectServiceNames);
      }
    };
    collectServiceNames(data.root);
    const serviceNamesArray = Array.from(serviceNames);

    // Process flame tree data
    const processTreeNode = (node: FlameTreeNode, threadId: number) => {
      const serviceName = node.id.includes(':') ? node.id.split(':')[0] : 'Unknown';
      const pid = serviceNamesArray.indexOf(serviceName) + 1 || 1;

      const startTimeUs = toMicroseconds(node.startTime);
      const durationUs = toMicroseconds(node.endTime - node.startTime);

      // Create a complete event (X phase)
      events.push({
        name: node.id,
        cat: 'function',
        ph: 'X', // Complete event
        ts: startTimeUs,
        dur: durationUs,
        pid: pid,
        tid: threadId,
        args: {
          spanId: node.spanId,
          duration: (node.endTime - node.startTime) / 1000,
        },
      });

      // Process children
      if (node.children) {
        node.children.forEach((child, index) => {
          processTreeNode(child, threadId * 1000 + index + 1);
        });
      }

      eventId++;
    };

    // Process the tree starting from root
    if (data.root.children) {
      data.root.children.forEach((child, index) => {
        processTreeNode(child, index + 1);
      });
    }

    // Add process name metadata
    serviceNamesArray.forEach((serviceName, index) => {
      events.push({
        name: 'process_name',
        ph: 'M',
        pid: index + 1,
        args: {
          name: serviceName,
        },
      });
    });

    // Add thread name metadata
    events.forEach((event, index) => {
      if (event.ph !== 'M' && event.tid) {
        events.push({
          name: 'thread_name',
          ph: 'M',
          pid: event.pid,
          tid: event.tid,
          args: {
            name: `Thread-${event.tid}`,
          },
        });
      }
    });

    // Remove duplicate thread metadata
    const uniqueThreads = new Map();
    const filteredEvents = events.filter(event => {
      if (event.name === 'thread_name') {
        const key = `${event.pid}-${event.tid}`;
        if (uniqueThreads.has(key)) {
          return false;
        }
        uniqueThreads.set(key, true);
      }
      return true;
    });

    return {
      traceEvents: filteredEvents.sort((a, b) => (a.ts || 0) - (b.ts || 0)),
      displayTimeUnit: 'ms',
      systemTraceEvents: [],
      otherData: {
        flowInsight: {
          flowId: currentFlowId,
          exportTime: new Date().toISOString(),
          version: '1.0',
        },
      },
    };
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const formatTimeLabel = () => {
    if (autoRefresh) {
      return 'Auto Refresh';
    }

    if (isLatestTime) {
      return 'Now';
    }

    // Calculate how far back the current timestamp is from now
    const timeDiff = Date.now() - currentTimestamp;

    if (timeDiff < 60000) {
      return `${Math.floor(timeDiff / 1000)}s ago`;
    } else if (timeDiff < 3600000) {
      return `${Math.floor(timeDiff / 60000)}m ago`;
    } else if (timeDiff < 86400000) {
      return `${Math.floor(timeDiff / 3600000)}h ago`;
    } else {
      return formatTime(currentTimestamp);
    }
  };

  // Apply selected timestamp - kept for compatibility but now uses snapshots
  const applyTimePoint = (timestamp: number) => {
    setCurrentTimestamp(timestamp);
    const isLatest = timestamp === Date.now();
    setIsLatestTime(isLatest);
    setSelectedSnapshot(isLatest ? 'latest' : 'latest'); // For now, always use latest
    fetchDatas('latest');
  };

  // Format flow duration for display
  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  if (error) {
    return <Box color="error.main">Error: {error}</Box>;
  }

  if (initialLoading) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        height: 'calc(100vh - 64px)',
        width: '100%',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          width: '100%',
        }}
      >
        <div className="header">
          <div
            className="title-container"
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '16px',
            }}
          >
            <h1 className="title" style={{ margin: 0 }}>
              Flow Insight
            </h1>
            <React.Fragment>
              <ToggleButtonGroup
                value={currentViewType}
                exclusive
                onChange={(event, value) => {
                  if (value !== null && !updating) {
                    handleViewTypeChange(value);
                  }
                }}
                aria-label="view type"
                size="small"
                sx={{
                  ml: '100px',
                  '& .MuiToggleButton-root': {
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    height: '32px',
                  },
                }}
              >
                <ToggleButton value="logical" aria-label="logical view" disabled={updating}>
                  Logical
                </ToggleButton>
                <ToggleButton value="physical" aria-label="physical view" disabled={updating}>
                  Physical
                </ToggleButton>
                <ToggleButton value="call_stack" aria-label="call stack view" disabled={updating}>
                  Call Stack
                </ToggleButton>
                <ToggleButton value="flame" aria-label="flame graph view" disabled={updating}>
                  Flame Graph
                </ToggleButton>
                <ToggleButton value="gantt" aria-label="gantt view" disabled={updating}>
                  Gantt
                </ToggleButton>
                <ToggleButton value="analysis" aria-label="analysis view" disabled={updating}>
                  Analysis
                </ToggleButton>
              </ToggleButtonGroup>

              <DebugPanel
                flowId={currentFlowId}
                selectedElement={infoCardData}
                apiService={apiService}
                expanded={debugPanelOpen}
              />

              <div
                style={{
                  marginLeft: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  height: '32px',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    padding: '2px 4px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={e => handleAutoRefreshChange(e.target.checked)}
                    style={{
                      marginRight: '8px',
                      width: '16px',
                      height: '16px',
                      cursor: 'pointer',
                    }}
                  />
                  Auto Refresh
                </label>
              </div>

              {/* IDE-style drawer toggle buttons */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                {handleUpdate && (
                  <Tooltip title="Update graph">
                    <IconButton
                      onClick={handleUpdate}
                      size="small"
                      disabled={updating}
                      sx={{
                        backgroundColor: 'white',
                        boxShadow: 1,
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        '&:hover': {
                          backgroundColor: 'grey.100',
                        },
                        '& svg': {
                          animation: updating ? 'spin 1s linear infinite' : 'none',
                        },
                        '@keyframes spin': {
                          '0%': {
                            transform: 'rotate(0deg)',
                          },
                          '100%': {
                            transform: 'rotate(360deg)',
                          },
                        },
                      }}
                    >
                      <RefreshCw size={16} />
                    </IconButton>
                  </Tooltip>
                )}

                {/* Time selector button */}
                <Tooltip
                  title={
                    autoRefresh
                      ? 'Time selection disabled during auto refresh'
                      : 'Select time point'
                  }
                >
                  <IconButton
                    onClick={handleTimeMenuClick}
                    size="small"
                    disabled={autoRefresh}
                    sx={{
                      backgroundColor: 'white',
                      boxShadow: 1,
                      padding: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      '&:hover': {
                        backgroundColor: 'grey.100',
                      },
                      border: isLatestTime
                        ? '1px solid rgba(25, 118, 210, 0.5)'
                        : '1px solid rgba(0, 0, 0, 0.12)',
                      color: isLatestTime ? 'primary.main' : 'text.primary',
                    }}
                  >
                    <Clock size={16} />
                  </IconButton>
                </Tooltip>

                {/* Time selector menu */}
                <Popover
                  open={timeMenuOpen}
                  anchorEl={timeMenuAnchorEl}
                  onClose={handleTimeMenuClose}
                  anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'center',
                  }}
                  transformOrigin={{
                    vertical: 'top',
                    horizontal: 'center',
                  }}
                  disableScrollLock={true}
                  disablePortal={false}
                  keepMounted={false}
                  disableAutoFocus={true}
                  disableEnforceFocus={true}
                  disableRestoreFocus={true}
                  sx={{
                    zIndex: 99999,
                    position: 'fixed',
                  }}
                  PaperProps={{
                    sx: {
                      width: '350px',
                      maxHeight: '500px',
                      overflow: 'auto',
                      marginTop: '8px',
                      border: '1px solid',
                      borderColor: 'divider',
                      boxShadow: theme => theme.shadows[8],
                      position: 'relative',
                    },
                    onClick: (e: any) => {
                      e.stopPropagation();
                    },
                    onMouseDown: (e: any) => {
                      e.stopPropagation();
                    },
                  }}
                >
                  {/* Latest option */}
                  <MenuItem
                    onClick={e => {
                      e.stopPropagation();
                      handleSnapshotSelect('latest');
                    }}
                    sx={{
                      fontWeight: selectedSnapshot === 'latest' ? 'bold' : 'normal',
                      backgroundColor:
                        selectedSnapshot === 'latest' ? 'action.selected' : 'transparent',
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                      <Clock size={16} style={{ marginRight: '8px' }} />
                      <Typography variant="body2">Latest (Live)</Typography>
                    </Box>
                  </MenuItem>

                  <Divider />

                  {/* Time range selection */}
                  <Box sx={{ p: 2 }} onClick={e => e.stopPropagation()}>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                      Select Time Point
                    </Typography>

                    {/* Quick time options */}
                    <Box sx={{ mb: 2 }}>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', mb: 1, display: 'block' }}
                      >
                        Quick Select:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {[
                          { label: '5m ago', minutes: 5 },
                          { label: '15m ago', minutes: 15 },
                          { label: '30m ago', minutes: 30 },
                          { label: '1h ago', minutes: 60 },
                          { label: '2h ago', minutes: 120 },
                          { label: '6h ago', minutes: 360 },
                        ].map(({ label, minutes }) => (
                          <Button
                            key={label}
                            variant="outlined"
                            size="small"
                            onClick={e => {
                              e.stopPropagation();
                              handleQuickTimeSelect(minutes);
                            }}
                            sx={{
                              fontSize: '0.7rem',
                              minWidth: 'auto',
                              px: 1,
                              py: 0.5,
                            }}
                          >
                            {label}
                          </Button>
                        ))}
                      </Box>
                    </Box>

                    {/* Custom time input */}
                    <Box sx={{ mb: 2 }}>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', mb: 1, display: 'block' }}
                      >
                        Custom Time:
                      </Typography>
                      <TextField
                        type="datetime-local"
                        size="small"
                        fullWidth
                        value={formatDateTimeForInput(currentTimestamp)}
                        onChange={e => {
                          e.stopPropagation();
                          handleCustomTimeSelect(e.target.value);
                        }}
                        onClick={e => e.stopPropagation()}
                        sx={{
                          '& .MuiInputBase-input': {
                            fontSize: '0.85rem',
                            py: 1,
                          },
                        }}
                      />
                    </Box>

                    {/* Snapshot navigation */}
                    {snapshots.length > 0 && (
                      <Box>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', mb: 1, display: 'block' }}
                        >
                          Navigate Snapshots ({snapshots.length} available):
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <IconButton
                            size="small"
                            onClick={e => {
                              e.stopPropagation();
                              handlePreviousSnapshot();
                            }}
                            disabled={!canGoPreviousSnapshot()}
                            sx={{
                              width: 28,
                              height: 28,
                              '&.Mui-disabled': { opacity: 0.3 },
                            }}
                          >
                            ←
                          </IconButton>
                          <Box sx={{ flex: 1, textAlign: 'center' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              {getCurrentSnapshotIndex()} of {snapshots.length + 1}
                            </Typography>
                            {!isLatestTime && (
                              <Typography
                                variant="caption"
                                sx={{ display: 'block', fontSize: '0.6rem' }}
                              >
                                {formatTime(currentTimestamp)}
                              </Typography>
                            )}
                          </Box>
                          <IconButton
                            size="small"
                            onClick={e => {
                              e.stopPropagation();
                              handleNextSnapshot();
                            }}
                            disabled={!canGoNextSnapshot()}
                            sx={{
                              width: 28,
                              height: 28,
                              '&.Mui-disabled': { opacity: 0.3 },
                            }}
                          >
                            →
                          </IconButton>
                        </Box>
                      </Box>
                    )}

                    <Divider sx={{ my: 1 }} />

                    {/* Action buttons */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Keep menu open and run operation in background
                          fetchSnapshots(currentFlowId!).catch(err => {
                            console.error('Failed to refresh snapshots:', err);
                          });
                        }}
                        sx={{ fontSize: '0.75rem', flex: 1 }}
                      >
                        Refresh
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          // Keep menu open and run operations in background
                          (async () => {
                            try {
                              await apiService.createSnapshot(currentFlowId!);
                              await fetchSnapshots(currentFlowId!);
                            } catch (err) {
                              console.error('Failed to create snapshot:', err);
                            }
                          })();
                        }}
                        sx={{ fontSize: '0.75rem', flex: 1 }}
                      >
                        Create New
                      </Button>
                    </Box>
                  </Box>
                </Popover>

                {(currentViewType === 'logical' ||
                  currentViewType === 'call_stack' ||
                  currentViewType === 'physical' ||
                  currentViewType === 'flame' ||
                  currentViewType === 'gantt' ||
                  currentViewType === 'analysis') && (
                  <Tooltip title="Export as SVG">
                    <IconButton
                      onClick={handleExportSvg}
                      size="small"
                      sx={{
                        backgroundColor: 'white',
                        boxShadow: 1,
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        '&:hover': {
                          backgroundColor: 'grey.100',
                        },
                      }}
                    >
                      <Download size={16} />
                    </IconButton>
                  </Tooltip>
                )}

                {(currentViewType === 'flame' || currentViewType === 'gantt') && flameData && (
                  <Tooltip title="Export as Chrome Tracing JSON">
                    <IconButton
                      onClick={handleExportChromeTracing}
                      size="small"
                      sx={{
                        backgroundColor: 'white',
                        boxShadow: 1,
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        '&:hover': {
                          backgroundColor: 'grey.100',
                        },
                      }}
                    >
                      <FileText size={16} />
                    </IconButton>
                  </Tooltip>
                )}

                <Tooltip title={debugPanelOpen ? 'Hide debug panel' : 'Show debug panel'}>
                  <IconButton
                    onClick={toggleDebugPanel}
                    size="small"
                    disabled={!isLatestTime}
                    sx={{
                      backgroundColor: debugPanelOpen ? 'grey.200' : 'white',
                      boxShadow: 1,
                      padding: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      '&:hover': {
                        backgroundColor: 'grey.100',
                      },
                      '&.Mui-disabled': {
                        backgroundColor: 'grey.300',
                        opacity: 0.5,
                      },
                    }}
                  >
                    <Bug size={16} />
                  </IconButton>
                </Tooltip>

                <Tooltip title={leftDrawerOpen ? 'Hide instances panel' : 'Show instances panel'}>
                  <IconButton
                    onClick={toggleLeftDrawer}
                    size="small"
                    sx={{
                      backgroundColor: leftDrawerOpen ? 'grey.200' : 'white',
                      boxShadow: 1,
                      padding: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      '&:hover': {
                        backgroundColor: 'grey.100',
                      },
                    }}
                  >
                    <PanelLeft size={16} />
                  </IconButton>
                </Tooltip>

                <Tooltip title={rightDrawerOpen ? 'Hide details panel' : 'Show details panel'}>
                  <IconButton
                    onClick={toggleRightDrawer}
                    size="small"
                    sx={{
                      backgroundColor: rightDrawerOpen ? 'grey.200' : 'white',
                      boxShadow: 1,
                      padding: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      '&:hover': {
                        backgroundColor: 'grey.100',
                      },
                    }}
                  >
                    <PanelRight size={16} />
                  </IconButton>
                </Tooltip>
              </div>
            </React.Fragment>
          </div>
          <div className="legends">
            <div className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: colorScheme.service }}
              ></span>
              <span>Service</span>
            </div>
            <div className="legend-item">
              <span className="legend-color" style={{ backgroundColor: colorScheme.method }}></span>
              <span>Method</span>
            </div>
            <div className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: colorScheme.function }}
              ></span>
              <span>Function</span>
            </div>
            {searchTerm && searchTerm.trim() !== '' && (
              <div className="legend-item">
                <span
                  className="legend-color"
                  style={{
                    backgroundColor: 'white',
                    border: '4px solid #4caf50',
                    borderRadius: '2px',
                    boxSizing: 'border-box',
                  }}
                ></span>
                <span>Search Match</span>
              </div>
            )}
          </div>
        </div>

        {graphData &&
          currentViewType === 'logical' &&
          (updating ? (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <Visualization
              ref={visualizationRef}
              // eslint-disable-next-line
              graphData={graphData!}
              physicalViewData={physicalViewData}
              flameData={flameData}
              viewType={currentViewType}
              onElementClick={handleElementClick}
              showInfoCard={false}
              selectedElementId={selectedElementId}
              flowId={currentFlowId}
              searchTerm={searchTerm}
              autoRefresh={autoRefresh}
              setViewType={setCurrentViewType}
              apiService={apiService}
              currentTimestamp={currentTimestamp}
            />
          ))}
        {currentViewType === 'call_stack' &&
          (updating ? (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <Visualization
              ref={visualizationRef}
              // eslint-disable-next-line
              graphData={stackGraphData!}
              physicalViewData={physicalViewData}
              flameData={flameData}
              viewType={currentViewType}
              onElementClick={handleElementClick}
              showInfoCard={false}
              selectedElementId={selectedElementId}
              flowId={currentFlowId}
              searchTerm={searchTerm}
              autoRefresh={autoRefresh}
              setViewType={setCurrentViewType}
              apiService={apiService}
              currentTimestamp={currentTimestamp}
            />
          ))}
        {graphData &&
          currentViewType === 'physical' &&
          (updating ? (
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
              }}
            >
              <CircularProgress />
            </Box>
          ) : (
            <PhysicalVisualization
              ref={physicalVisualizationRef}
              // eslint-disable-next-line
              physicalViewData={physicalViewData!}
              onElementClick={handleElementClick}
              selectedElementId={selectedElementId}
              flowId={currentFlowId}
              onUpdate={handleUpdate}
              updating={updating}
              searchTerm={searchTerm}
            />
          ))}
        {flameData && currentViewType === 'flame' && (
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              height: '600px',
            }}
          >
            {updating ? (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                }}
              >
                <CircularProgress />
              </Box>
            ) : flameData ? (
              <FlameVisualization
                ref={flameVisualizationRef}
                flameData={flameData}
                onElementClick={handleElementClick}
                selectedElementId={selectedElementId}
                flowId={currentFlowId}
                onUpdate={handleUpdate}
                updating={updating}
                searchTerm={searchTerm}
                // eslint-disable-next-line
                graphData={graphData!}
                physicalViewData={physicalViewData || undefined}
                currentTimestamp={currentTimestamp}
              />
            ) : (
              <div className="loading-container">
                <p>No flame graph data available</p>
              </div>
            )}
          </div>
        )}
        {flameData && currentViewType === 'gantt' && (
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              height: '600px',
            }}
          >
            {updating ? (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                }}
              >
                <CircularProgress />
              </Box>
            ) : flameData ? (
              <GanttVisualization
                ref={ganttVisualizationRef}
                flameData={flameData}
                onElementClick={handleElementClick}
                selectedElementId={selectedElementId}
                flowId={currentFlowId}
                onUpdate={handleUpdate}
                updating={updating}
                searchTerm={searchTerm}
                // eslint-disable-next-line
                graphData={graphData!}
                currentTimestamp={currentTimestamp}
              />
            ) : (
              <div className="loading-container">
                <p>No gantt data available</p>
              </div>
            )}
          </div>
        )}
        {currentViewType === 'analysis' && (
          <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
            {updating ? (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  height: '100%',
                }}
              >
                <CircularProgress />
              </Box>
            ) : (
              <InsightPanel
                flowId={currentFlowId}
                graphData={graphData}
                physicalViewData={physicalViewData}
                flameData={flameData}
                apiService={apiService}
                isLatestTime={isLatestTime}
                timestamp={currentTimestamp}
              />
            )}
          </Box>
        )}
      </Box>

      <ElementsPanel
        onElementSelect={handleElementClick}
        selectedElementId={selectedElementId || ''}
        onSearchChange={handleSearchChange}
        graphData={
          graphData || {
            services: [],
            methods: [],
            functions: [],
            callFlows: [],
            dataFlows: [],
          }
        }
        isOpen={leftDrawerOpen}
      />

      <InfoCard
        data={infoCardData}
        visible={true}
        graphData={
          graphData || {
            services: [],
            methods: [],
            functions: [],
            callFlows: [],
            dataFlows: [],
          }
        }
        currentView={currentViewType}
        onNavigateToLogicalView={nodeId => {
          visualizationRef.current?.navigateToView('logical');
          setSelectedElementId(nodeId);
        }}
        isOpen={rightDrawerOpen}
      />
    </Box>
  );
};

export default GraphPage;
