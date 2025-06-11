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
} from '@mui/material';
import { Download, RefreshCw, PanelLeft, PanelRight, Bug, Clock } from 'lucide-react';
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

  // Replace timelineRange with a single startTimestamp
  const [startTimestamp, setStartTimestamp] = useState<number>(Date.now() - 3600000);
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
  const [customTimeValue, setCustomTimeValue] = useState<string>('');
  const [customTimeUnit, setCustomTimeUnit] = useState<string>('m');

  // Predefined time ranges
  const timeRangeOptions = [
    { label: 'Last 10 seconds', value: 10 * 1000 },
    { label: 'Last 30 seconds', value: 30 * 1000 },
    { label: 'Last 1 minutes', value: 1 * 60 * 1000 },
    { label: 'Last 5 minutes', value: 5 * 60 * 1000 },
    { label: 'Last 15 minutes', value: 15 * 60 * 1000 },
    { label: 'Last 30 minutes', value: 30 * 60 * 1000 },
    { label: 'Last 1 hour', value: 60 * 60 * 1000 },
    { label: 'Last 3 hours', value: 3 * 60 * 60 * 1000 },
    { label: 'Last 6 hours', value: 6 * 60 * 60 * 1000 },
    { label: 'Last 12 hours', value: 12 * 60 * 60 * 1000 },
    { label: 'Last 24 hours', value: 24 * 60 * 60 * 1000 },
  ];

  const fetchGraphData = useCallback(
    async (id?: string, stackMode?: boolean, isLatestTime?: boolean, timestamp?: number) => {
      if (!id) {
        return;
      }

      try {
        const graphData = await apiService.getGraphData(
          id,
          stackMode,
          isLatestTime ? undefined : timestamp
        );

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
    [apiService]
  );

  // Update currentFlowId when route FlowId changes
  useEffect(() => {
    if (routeFlowId) {
      setCurrentFlowId(routeFlowId);
    }
  }, [routeFlowId]);

  // Fetch flow creation time and calculate duration
  useEffect(() => {
    if (currentFlowId) {
      (async () => {
        try {
          // Get flow creation time from API
          const creationTime = await apiService.getFlowCreationTime(currentFlowId);
          const now = Date.now();
          // Update start timestamp with the flow creation time
          setStartTimestamp(creationTime);
          setCurrentTimestamp(now);
          // Calculate flow duration
          setFlowDuration(now - creationTime);
        } catch (err) {
          console.error('Failed to fetch flow creation time:', err);
        }
      })();
    }
  }, [currentFlowId, apiService]);

  // Update the current timestamp periodically if auto-refresh is enabled
  useEffect(() => {
    if (autoRefresh) {
      const intervalId = setInterval(() => {
        const now = Date.now();
        // When auto-refresh is enabled, always update the timestamp to the latest
        setCurrentTimestamp(now);
        // Ensure isLatestTime remains true during auto-refresh
        setIsLatestTime(true);
      }, 5000);

      return () => {
        clearInterval(intervalId);
      };
    }
  }, [autoRefresh]);

  // Initial data fetch
  useEffect(() => {
    if (currentFlowId) {
      (async () => {
        setInitialLoading(true);
        try {
          await fetchGraphData(currentFlowId, false);
          await fetchGraphData(currentFlowId, true);
          const data = await apiService.getPhysicalViewData(currentFlowId);
          setPhysicalViewData(data);
          const flameData = await apiService.getFlameGraphData(currentFlowId);
          setFlameData(flameData);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch view data');
        } finally {
          setInitialLoading(false);
        }
      })();
    }
  }, [currentFlowId, fetchGraphData, apiService]);

  // eslint-disable-next-line
  const fetchDatas = async (isLatest?: boolean, timestamp?: number, showLoading = true, viewType?: string) => {
    const useLatestTime = isLatest !== undefined ? isLatest : isLatestTime;
    const useTimestamp = timestamp !== undefined ? timestamp : currentTimestamp;
    const targetViewType = viewType || currentViewType;

    try {
      if (showLoading) {
        setUpdating(true);
      }

      if (targetViewType === 'call_stack') {
        await fetchGraphData(currentFlowId, true, useLatestTime, useTimestamp);
      }
      if (targetViewType === 'logical') {
        await fetchGraphData(currentFlowId, false, useLatestTime, useTimestamp);
      }
      if (targetViewType === 'physical') {
        await fetchGraphData(currentFlowId, false, useLatestTime, useTimestamp);
        try {
          const data = await apiService.getPhysicalViewData(
            currentFlowId!,
            useLatestTime ? undefined : useTimestamp
          );
          setPhysicalViewData(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch physical view data');
        }
      }
      if (targetViewType === 'flame' || targetViewType === 'gantt' || targetViewType === 'analysis') {
        await fetchGraphData(currentFlowId, false, useLatestTime, useTimestamp);
        try {
          const data = await apiService.getPhysicalViewData(
            currentFlowId!,
            useLatestTime ? undefined : useTimestamp
          );
          setPhysicalViewData(data);
          const flameData = await apiService.getFlameGraphData(
            currentFlowId!,
            useLatestTime ? undefined : useTimestamp
          );
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
  // Auto-refresh effect for call stack view
  useEffect(() => {
    if (autoRefresh) {
      const intervalId = setInterval(async () => {
        await fetchDatas(undefined, undefined, false);
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
    // eslint-disable-next-line
  }, [autoRefresh, currentFlowId, fetchGraphData, currentViewType]);

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
    // Always get latest data and update timeline when manually updating
    const now = Date.now();
    setCurrentTimestamp(now);
    setIsLatestTime(true);

    await fetchDatas(true, undefined, false);
  }, [fetchDatas]);

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const handleViewTypeChange = useCallback(
    async (viewType: 'logical' | 'call_stack' | 'physical' | 'flame' | 'gantt' | 'analysis') => {
      // First change to the new view type
      setCurrentViewType(viewType);

      // Then fetch data for this view type with the current time settings, passing the viewType explicitly
      await fetchDatas(isLatestTime, currentTimestamp, true, viewType);
    },
    [fetchDatas, isLatestTime, currentTimestamp]
  );

  // Handle time menu open
  const handleTimeMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    setTimeMenuAnchorEl(event.currentTarget);

    // Call get_flow_creation_time each time time range is opened
    if (currentFlowId) {
      (async () => {
        try {
          // Get flow creation time from API
          const creationTime = await apiService.getFlowCreationTime(currentFlowId);
          const now = Date.now();
          // Update start timestamp with the flow creation time
          setStartTimestamp(creationTime);
          // Calculate flow duration
          setFlowDuration(now - creationTime);
        } catch (err) {
          console.error('Failed to fetch flow creation time:', err);
        }
      })();
    }
  };

  // Handle time menu close
  const handleTimeMenuClose = () => {
    setTimeMenuAnchorEl(null);
  };

  // Handle time range selection
  const handleTimeRangeSelect = (rangeMs: number) => {
    const now = Date.now();
    // Only calculate a new start point, don't change the current timestamp
    // which remains the endpoint for the time range
    const newStartTimestamp = now - rangeMs;

    // Make sure we don't go earlier than the flow start time
    if (newStartTimestamp < startTimestamp) {
      // Keep using the original start timestamp
      // No change needed
    } else {
      setStartTimestamp(newStartTimestamp);
    }

    applyTimePoint(newStartTimestamp);
    handleTimeMenuClose();
  };

  const handleAutoRefreshChange = useCallback((enabled: boolean) => {
    setAutoRefresh(enabled);

    // When enabling auto-refresh, set to latest time
    if (enabled) {
      const now = Date.now();
      setCurrentTimestamp(now);
      setIsLatestTime(true);
    }
  }, []);

  // Handle setting current time to now
  const handleSetToNow = () => {
    const now = Date.now();
    setCurrentTimestamp(now);
    setIsLatestTime(true);
    fetchDatas(true);
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

  // Apply selected timestamp for the end_time parameter
  const applyTimePoint = (timestamp: number) => {
    setCurrentTimestamp(timestamp);
    setIsLatestTime(timestamp === Date.now());
    fetchDatas(timestamp === Date.now(), timestamp);
  };

  // Handle custom time input change
  const handleCustomTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomTimeValue(event.target.value);
  };

  // Handle custom time unit change
  const handleCustomTimeUnitChange = (unit: string) => {
    setCustomTimeUnit(unit);
  };

  // Handle custom time submission
  const handleCustomTimeSubmit = () => {
    const value = parseInt(customTimeValue, 10);
    if (isNaN(value) || value <= 0) {
      return;
    }

    let milliseconds = 0;
    switch (customTimeUnit) {
      case 's':
        milliseconds = value * 1000;
        break;
      case 'm':
        milliseconds = value * 60 * 1000;
        break;
      case 'h':
        milliseconds = value * 60 * 60 * 1000;
        break;
      case 'd':
        milliseconds = value * 24 * 60 * 60 * 1000;
        break;
      default:
        milliseconds = value * 60 * 1000; // default to minutes
    }

    const now = Date.now();
    const newStartTimestamp = now - milliseconds;

    // Check if time range exceeds flow duration
    if (newStartTimestamp < startTimestamp) {
      // If exceeds, don't change the start timestamp
      // No change needed
    } else {
      setStartTimestamp(newStartTimestamp);
    }

    applyTimePoint(newStartTimestamp);

    handleTimeMenuClose();
    setCustomTimeValue('');
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

  // Check if a time range exceeds flow duration
  const isTimeRangeExceedingDuration = (rangeMs: number) => {
    if (!flowDuration) return false;
    return rangeMs > flowDuration;
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

                {/* Time selector button - moved to align with IDE button group */}
                <Tooltip
                  title={
                    autoRefresh
                      ? 'Time selection disabled during auto refresh'
                      : 'Select time range'
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

                {/* Time selection menu */}
                <Menu
                  anchorEl={timeMenuAnchorEl}
                  open={timeMenuOpen}
                  onClose={handleTimeMenuClose}
                  MenuListProps={{
                    'aria-labelledby': 'time-selector-button',
                  }}
                  slotProps={{
                    paper: {
                      sx: {
                        width: '220px',
                        maxHeight: '400px',
                        overflow: 'auto',
                        zIndex: 100000,
                      },
                    },
                  }}
                  style={{ zIndex: 100000 }}
                  sx={{ zIndex: 100000 }}
                >
                  <MenuItem
                    onClick={handleSetToNow}
                    sx={{ fontWeight: isLatestTime ? 'bold' : 'normal' }}
                  >
                    Now
                  </MenuItem>

                  <Divider />

                  {flowDuration && (
                    <>
                      <Typography
                        variant="caption"
                        sx={{ p: 1, display: 'block', color: 'text.secondary' }}
                      >
                        Flow duration: {formatDuration(flowDuration)}
                      </Typography>
                      <Divider />
                    </>
                  )}

                  {/* Move custom field above quick range */}
                  <Typography
                    variant="caption"
                    sx={{ p: 1, display: 'block', color: 'text.secondary' }}
                  >
                    Custom time range
                  </Typography>

                  <Box sx={{ p: 1, display: 'flex', alignItems: 'center' }}>
                    <TextField
                      size="small"
                      value={customTimeValue}
                      onChange={handleCustomTimeChange}
                      onKeyPress={e => {
                        if (e.key === 'Enter') {
                          handleCustomTimeSubmit();
                        }
                      }}
                      type="number"
                      inputProps={{
                        min: 1,
                        sx: {
                          fontSize: '0.75rem', // Make font inside custom field input smaller
                          padding: '8px 6px',
                        },
                      }}
                      sx={{ width: '80px', mr: 1 }}
                      placeholder="Time"
                    />
                    <Box sx={{ display: 'flex', gap: '4px' }}>
                      {['s', 'm', 'h', 'd'].map(unit => (
                        <Button
                          key={unit}
                          size="small"
                          variant={customTimeUnit === unit ? 'contained' : 'outlined'}
                          onClick={() => handleCustomTimeUnitChange(unit)}
                          sx={{
                            minWidth: '24px',
                            p: '2px 8px',
                            fontSize: '0.75rem', // Make font smaller
                          }}
                        >
                          {unit}
                        </Button>
                      ))}
                    </Box>
                  </Box>

                  <Box sx={{ p: 1 }}>
                    <Button
                      variant="contained"
                      size="small"
                      fullWidth
                      onClick={handleCustomTimeSubmit}
                      disabled={!customTimeValue || parseInt(customTimeValue, 10) <= 0}
                      sx={{ fontSize: '0.75rem' }} // Make font smaller
                    >
                      Apply
                    </Button>
                  </Box>

                  <Divider />

                  <Typography
                    variant="caption"
                    sx={{ p: 1, display: 'block', color: 'text.secondary' }}
                  >
                    Quick ranges
                  </Typography>

                  {timeRangeOptions.map(option => {
                    const exceeds = isTimeRangeExceedingDuration(option.value);
                    return (
                      <MenuItem
                        key={option.value}
                        onClick={() => handleTimeRangeSelect(option.value)}
                        sx={{
                          color: exceeds ? 'text.disabled' : 'text.primary',
                          '&:hover': {
                            backgroundColor: exceeds ? 'transparent' : undefined,
                          },
                          fontSize: '0.8rem', // Make font smaller
                        }}
                        disabled={exceeds}
                      >
                        {option.label}
                        {exceeds && (
                          <Typography variant="caption" sx={{ ml: 1, color: 'text.disabled' }}>
                            (exceeds duration)
                          </Typography>
                        )}
                      </MenuItem>
                    );
                  })}
                </Menu>

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
