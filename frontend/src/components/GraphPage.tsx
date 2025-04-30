import {
  Box,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Slider,
  Typography,
} from '@mui/material';
import { Download, RefreshCw, PanelLeft, PanelRight, Bug } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import InsightPanel from './Analysis';
import DebugPanel from './DebugPanel';
import ElementsPanel from './ElementsPanel';
import FlameVisualization, { FlameVisualizationHandle } from './Flame';
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

// Create an ApiService instance
const apiService = new ApiService({ baseUrl: '' });

type ElementData = Service | Method | FunctionNode;

type RouteParams = Record<string, string | undefined>;

// Define GraphPage props interface
type GraphPageProps = {
  graphData?: GraphData;
  stackGraphData?: GraphData | null;
  physicalViewData?: PhysicalViewData | null;
  flameData?: FlameGraphData | null;
  flowId?: string;
  initialViewType?: 'logical' | 'call_stack' | 'physical' | 'flame' | 'analysis';
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
  apiService: externalApiService,
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
    'logical' | 'call_stack' | 'physical' | 'flame' | 'analysis'
  >(initialViewType || 'logical');
  const visualizationRef = useRef<VisualizationHandle>(null);
  const physicalVisualizationRef = useRef<PhysicalVisualizationHandle>(null);
  const flameVisualizationRef = useRef<FlameVisualizationHandle>(null);
  const autoRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [updating, setUpdating] = useState(false);

  // State for drawer visibility
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(true);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(true);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);

  // Use the provided API service or the local one
  const activeApiService = externalApiService || apiService;

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

  const [timelineRange, setTimelineRange] = useState<[number, number]>([
    Date.now() - 3600000,
    Date.now(),
  ]);

  const fetchGraphData = useCallback(
    async (id?: string, stackMode?: boolean, isLatestTime?: boolean, timestamp?: number) => {
      if (!id) {
        return;
      }

      try {
        const graphData = await activeApiService.getGraphData(
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
    [activeApiService]
  );

  // Update currentFlowId when route FlowId changes
  useEffect(() => {
    if (routeFlowId) {
      setCurrentFlowId(routeFlowId);
    }
  }, [routeFlowId]);

  // Fetch flow creation time
  useEffect(() => {
    if (currentFlowId) {
      (async () => {
        try {
          // Get flow creation time from API
          const creationTime = await activeApiService.getFlowCreationTime(currentFlowId);
          const now = Date.now();
          // Update timeline range with the flow creation time
          setTimelineRange([creationTime, now]);
          setCurrentTimestamp(now);
        } catch (err) {
          console.error('Failed to fetch flow creation time:', err);
        }
      })();
    }
  }, [currentFlowId, activeApiService]);

  // Initial data fetch
  useEffect(() => {
    if (currentFlowId) {
      (async () => {
        await fetchGraphData(currentFlowId, false);
        await fetchGraphData(currentFlowId, true);
        try {
          const data = await activeApiService.getPhysicalViewData(currentFlowId);
          setPhysicalViewData(data);
          const flameData = await activeApiService.getFlameGraphData(currentFlowId);
          setFlameData(flameData);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch view data');
        }
      })();
    }
  }, [currentFlowId, fetchGraphData, activeApiService]);

  // Update the timeline range periodically if auto-refresh is enabled
  useEffect(() => {
    if (autoRefresh) {
      const intervalId = setInterval(() => {
        const now = Date.now();
        // Keep the start time (flow creation time) but update the end time
        setTimelineRange(prevRange => [prevRange[0], now]);
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

  // eslint-disable-next-line
  const fetchDatas = async (isLatestTime?: boolean, timestamp?: number) => {
    if (currentViewType === 'call_stack') {
      await fetchGraphData(currentFlowId, true, isLatestTime, timestamp);
    }
    if (currentViewType === 'logical') {
      await fetchGraphData(currentFlowId, false, isLatestTime, timestamp);
    }
    if (currentViewType === 'physical') {
      await fetchGraphData(currentFlowId, false, isLatestTime, timestamp);
      try {
        const data = await activeApiService.getPhysicalViewData(
          currentFlowId!,
          isLatestTime ? undefined : currentTimestamp
        );
        setPhysicalViewData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch physical view data');
      }
    }
    if (currentViewType === 'flame' || currentViewType === 'analysis') {
      await fetchGraphData(currentFlowId, false);
      try {
        const data = await activeApiService.getPhysicalViewData(
          currentFlowId!,
          isLatestTime ? undefined : currentTimestamp
        );
        setPhysicalViewData(data);
        const flameData = await activeApiService.getFlameGraphData(
          currentFlowId!,
          isLatestTime ? undefined : currentTimestamp
        );
        setFlameData(flameData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch view data');
      }
    }
  };
  // Auto-refresh effect for call stack view
  useEffect(() => {
    if (autoRefresh) {
      const intervalId = setInterval(async () => {
        await fetchDatas();
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
    setUpdating(true);

    // Always get latest data and update timeline when manually updating
    const now = Date.now();
    setTimelineRange(prevRange => [prevRange[0], now]);
    setCurrentTimestamp(now);
    setIsLatestTime(true);

    await fetchDatas(true);
    setUpdating(false);
  }, [fetchDatas]);

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const handleViewTypeChange = useCallback(
    (viewType: 'logical' | 'call_stack' | 'physical' | 'flame' | 'analysis') => {
      setCurrentViewType(viewType);
    },
    []
  );

  const handleTimelineChange = (event: Event, newValue: number | number[]) => {
    const timestamp = newValue as number;
    setCurrentTimestamp(timestamp);
    setIsLatestTime(timestamp === timelineRange[1]);

    const isLatest = timestamp === timelineRange[1];
    fetchDatas(isLatest, timestamp);
  };

  const handleAutoRefreshChange = useCallback((enabled: boolean) => {
    setAutoRefresh(enabled);

    // When enabling auto-refresh, set to latest time
    if (enabled) {
      const now = Date.now();
      setCurrentTimestamp(now);
      setIsLatestTime(true);
      // Update the end of timeline range to now
      setTimelineRange(prevRange => [prevRange[0], now]);
    }
  }, []);

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

  if (error) {
    return <Box color="error.main">Error: {error}</Box>;
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
                  if (value !== null) {
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
                <ToggleButton value="logical" aria-label="logical view">
                  Logical
                </ToggleButton>
                <ToggleButton value="physical" aria-label="physical view">
                  Physical
                </ToggleButton>
                <ToggleButton value="call_stack" aria-label="call stack view">
                  Call Stack
                </ToggleButton>
                <ToggleButton value="flame" aria-label="flame graph view">
                  Flame Graph
                </ToggleButton>
                <ToggleButton value="analysis" aria-label="analysis view">
                  Analysis
                </ToggleButton>
              </ToggleButtonGroup>
              <DebugPanel
                flowId={currentFlowId}
                selectedElement={infoCardData}
                apiService={activeApiService}
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

                {(currentViewType === 'logical' ||
                  currentViewType === 'call_stack' ||
                  currentViewType === 'physical' ||
                  currentViewType === 'flame' ||
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

        {graphData && currentViewType === 'logical' && (
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
            apiService={activeApiService}
            currentTimestamp={currentTimestamp}
          />
        )}
        {currentViewType === 'call_stack' && (
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
            apiService={activeApiService}
            currentTimestamp={currentTimestamp}
          />
        )}
        {graphData && currentViewType === 'physical' && (
          <PhysicalVisualization
            ref={physicalVisualizationRef}
            // eslint-disable-next-line
            physicalViewData={physicalViewData!}
            onElementClick={handleElementClick}
            selectedElementId={selectedElementId}
            flowId={currentFlowId}
            onUpdate={handleUpdate}
            updating={false}
            searchTerm={searchTerm}
          />
        )}
        {flameData && currentViewType === 'flame' && (
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              width: '100%',
              height: '600px',
            }}
          >
            {flameData ? (
              <FlameVisualization
                ref={flameVisualizationRef}
                flameData={flameData}
                onElementClick={handleElementClick}
                selectedElementId={selectedElementId}
                flowId={currentFlowId}
                onUpdate={handleUpdate}
                updating={false}
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
        {currentViewType === 'analysis' && (
          <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
            <InsightPanel
              flowId={currentFlowId}
              graphData={graphData}
              physicalViewData={physicalViewData}
              flameData={flameData}
              apiService={activeApiService}
            />
          </Box>
        )}

        {/* Timeline slider */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '40%',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            padding: '8px 16px',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Typography
            variant="caption"
            sx={{ alignSelf: 'flex-end', color: isLatestTime ? 'primary.main' : 'text.secondary' }}
          >
            {autoRefresh
              ? 'Live (Auto Refresh)'
              : isLatestTime
                ? 'Live'
                : formatTime(currentTimestamp)}
          </Typography>
          <Slider
            value={autoRefresh ? timelineRange[1] : currentTimestamp}
            min={timelineRange[0]}
            max={timelineRange[1]}
            onChange={handleTimelineChange}
            disabled={autoRefresh}
            aria-labelledby="timeline-slider"
            sx={{
              width: '100%',
              '& .MuiSlider-thumb': {
                width: 16,
                height: 16,
                backgroundColor: isLatestTime ? 'primary.main' : 'grey.500',
              },
              '& .Mui-disabled': {
                color: 'primary.main',
              },
            }}
            valueLabelDisplay="auto"
            valueLabelFormat={formatTime}
          />
          <Box sx={{ display: 'flex', width: '100%', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {formatTime(timelineRange[0])}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatTime(timelineRange[1])}
            </Typography>
          </Box>
        </Box>
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
