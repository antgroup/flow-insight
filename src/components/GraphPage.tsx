import { Download, RefreshCw, PanelLeft, PanelRight, Bug } from 'lucide-react';
import {
  Box,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import DebugPanel from "./DebugPanel";
import InsightPanel from "./Analysis";
import ElementsPanel from "./ElementsPanel";
import { colorScheme } from "./Visualization";
import InfoCard from "./InfoCard";
import PhysicalVisualization, {
  PhysicalVisualizationHandle,
} from "./Physical";
import FlameVisualization, {
  FlameVisualizationHandle,
} from "./Flame";
import Visualization, {
  VisualizationHandle,
} from "./Visualization";
import { GraphData, Service, Method, FunctionNode, PhysicalViewData, FlameGraphData} from "../types";
import { ApiService } from "../services/api";

// Create an ApiService instance
const apiService = new ApiService({ baseUrl: "" });

type ElementData = Service | Method | FunctionNode;

type RouteParams = Record<string, string | undefined>;

// Define GraphPage props interface
type GraphPageProps = {
  graphData?: GraphData;
  stackGraphData?: GraphData | null;
  physicalViewData?: PhysicalViewData | null;
  flameData?: FlameGraphData | null;
  jobId?: string;
  initialViewType?: "logical" | "call_stack" | "physical" | "flame" | "analysis";
  autoRefresh?: boolean;
  onElementClick?: (data: ElementData, skip_zoom?: boolean) => void;
  selectedElementId?: string | null;
  onUpdate?: () => Promise<void>;
  colorScheme?: Record<string, string>;
  apiService: ApiService;
}

const GraphPage: React.FC<GraphPageProps> = ({
  graphData: initialGraphData,
  stackGraphData: initialStackGraphData,
  physicalViewData: initialPhysicalViewData,
  flameData: initialFlameData,
  jobId: propJobId,
  initialViewType = "logical",
  autoRefresh: initialAutoRefresh = false,
  onElementClick: externalElementClick,
  selectedElementId: initialSelectedElementId,
  onUpdate: externalUpdate,
  colorScheme: customColorScheme,
  apiService: externalApiService,
}) => {
  const { jobId: routeJobId } = useParams<RouteParams>();
  const [graphData, setGraphData] = useState<GraphData | null>(initialGraphData || null);
  const [stackGraphData, setStackGraphData] = useState<GraphData | null>(initialStackGraphData || null);
  const [physicalViewData, setPhysicalViewData] = useState<PhysicalViewData | null>(initialPhysicalViewData || null);
  const [flameData, setFlameData] = useState<FlameGraphData | null>(initialFlameData || null);
  const [error, setError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | undefined>(propJobId || routeJobId);
  const [searchTerm, setSearchTerm] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh);
  const [currentViewType, setCurrentViewType] = useState<"logical" | "call_stack" | "physical" | "flame" | "analysis">(initialViewType || "logical");
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

  // State management similar to App.tsx
  const [infoCardData, setInfoCardData] = useState<ElementData>({
    id: "default",
    type: "function",
    name: "Component Details",
  });

  const [selectedElementId, setSelectedElementId] =
    useState<string | null>(initialSelectedElementId || null);

  const fetchGraphData = useCallback(
    async (id?: string, stackMode?: boolean) => {
      if (!id) {
        return;
      }

      try {
        const graphData = await activeApiService.getGraphData(id, stackMode);
        
        if (graphData) {
          if (stackMode) {
            setStackGraphData(graphData);
          } else {
            setGraphData(graphData);
          }
          setError(null);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch graph data",
        );
      }
    },
    [activeApiService],
  );

  // Update currentJobId when route jobId changes
  useEffect(() => {
    if (routeJobId) {
      setCurrentJobId(routeJobId);
    }
  }, [routeJobId]);

  // Initial data fetch
  useEffect(() => {
    if (currentJobId) {
      (async () => {
        await fetchGraphData(currentJobId, false);
        await fetchGraphData(currentJobId, true);
        try {
          const data = await activeApiService.getPhysicalViewData(currentJobId);
          setPhysicalViewData(data);
          const flameData = await activeApiService.getFlameGraphData(currentJobId);
          setFlameData(flameData);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch view data",
          );
        }
      })();
    }
  }, [currentJobId, fetchGraphData]);

  // eslint-disable-next-line
  const fetchDatas = async () => {
    if (currentViewType === "call_stack") {
      await fetchGraphData(currentJobId, true);
    }
    if (currentViewType === "logical") {
      await fetchGraphData(currentJobId, false);
    }
    if (currentViewType === "physical") {
      await fetchGraphData(currentJobId, false);
      try {
        const data = await activeApiService.getPhysicalViewData(currentJobId);
        setPhysicalViewData(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch physical view data",
        );
      }
    }
    if (currentViewType === "flame" || currentViewType === "analysis") {
      await fetchGraphData(currentJobId, false);
      try {
        const data = await activeApiService.getPhysicalViewData(currentJobId);
        setPhysicalViewData(data);
        const flameData = await activeApiService.getFlameGraphData(currentJobId);
        setFlameData(flameData);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch view data",
        );
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
  }, [autoRefresh, currentJobId, fetchGraphData, currentViewType]);

  const handleElementClick = useCallback(
    (data: ElementData, skip_zoom = false) => {
      console.log("Element clicked:", data);
      setInfoCardData({ ...data });
      if (skip_zoom) {
        return;
      }

      if (data && data.id) {
        setSelectedElementId(data.id);
      }
    },
    [],
  );

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    await fetchDatas();
    setUpdating(false);
  }, [fetchDatas]);

  const handleSearchChange = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const handleViewTypeChange = useCallback(
    (
      viewType: "logical" | "call_stack" | "physical" | "flame" | "analysis",
    ) => {
      setCurrentViewType(viewType);
    },
    [],
  );

  const handleAutoRefreshChange = useCallback((enabled: boolean) => {
    setAutoRefresh(enabled);
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
      case "logical":
      case "call_stack":
        visualizationRef.current?.exportSvg();
        break;
      case "physical":
        physicalVisualizationRef.current?.exportSvg();
        break;
      case "flame":
        flameVisualizationRef.current?.exportSvg();
        break;
      default:
        console.warn("Export not supported for this view type");
    }
  };

  if (error) {
    return <Box color="error.main">Error: {error}</Box>;
  }

  return (
    <Box
      sx={{
        display: "flex",
        height: "calc(100vh - 64px)",
        width: "100%",
        position: "relative",
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          width: "100%",
        }}
      >
        <div className="header">
          <div className="title-container" style={{ 
            display: "flex", 
            alignItems: "center", 
            flexWrap: "wrap",
            gap: "8px",
            marginTop: "16px"
          }}>
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
                  ml: "100px",
                  '& .MuiToggleButton-root': {
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    height: '32px',
                  }
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
                <DebugPanel jobId={currentJobId} selectedElement={infoCardData} apiService={activeApiService} expanded={debugPanelOpen} />

              <div style={{ 
                marginLeft: '16px', 
                display: 'flex', 
                alignItems: 'center',
                height: '32px'
              }}>
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  cursor: 'pointer',
                  padding: '2px 4px'
                }}>
                  <input
                    type="checkbox"
                    checked={autoRefresh}
                    onChange={(e) => handleAutoRefreshChange(e.target.checked)}
                    style={{ 
                      marginRight: '8px',
                      width: '16px',
                      height: '16px',
                      cursor: 'pointer'
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
                        backgroundColor: "white",
                        boxShadow: 1,
                        padding: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        "&:hover": {
                          backgroundColor: "grey.100",
                        },
                        "& svg": {
                          animation: updating ? "spin 1s linear infinite" : "none",
                        },
                        "@keyframes spin": {
                          "0%": {
                            transform: "rotate(0deg)",
                          },
                          "100%": {
                            transform: "rotate(360deg)",
                          },
                        },
                      }}
                    >
                      <RefreshCw size={16} />
                    </IconButton>
                  </Tooltip>
                )}
                
                {(currentViewType === "logical" ||
                  currentViewType === "call_stack" ||
                  currentViewType === "physical" ||
                  currentViewType === "flame") && (
                  <Tooltip title="Export as SVG">
                    <IconButton
                      onClick={handleExportSvg}
                      size="small"
                      sx={{
                        backgroundColor: "white",
                        boxShadow: 1,
                        padding: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        "&:hover": {
                          backgroundColor: "grey.100",
                        },
                      }}
                    >
                      <Download size={16} />
                    </IconButton>
                  </Tooltip>
                )}
                
                <Tooltip title={debugPanelOpen ? "Hide debug panel" : "Show debug panel"}>
                  <IconButton
                    onClick={toggleDebugPanel}
                    size="small"
                    sx={{
                      backgroundColor: debugPanelOpen ? "grey.200" : "white",
                      boxShadow: 1,
                      padding: "6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      "&:hover": {
                        backgroundColor: "grey.100",
                      },
                    }}
                  >
                    <Bug size={16} />
                  </IconButton>
                </Tooltip>
 
                <Tooltip title={leftDrawerOpen ? "Hide instances panel" : "Show instances panel"}>
                  <IconButton
                    onClick={toggleLeftDrawer}
                    size="small"
                    sx={{
                      backgroundColor: leftDrawerOpen ? "grey.200" : "white",
                      boxShadow: 1,
                      padding: "6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      "&:hover": {
                        backgroundColor: "grey.100",
                      },
                    }}
                  >
                    <PanelLeft size={16} />
                  </IconButton>
                </Tooltip>
                
                <Tooltip title={rightDrawerOpen ? "Hide details panel" : "Show details panel"}>
                  <IconButton
                    onClick={toggleRightDrawer}
                    size="small"
                    sx={{
                      backgroundColor: rightDrawerOpen ? "grey.200" : "white",
                      boxShadow: 1,
                      padding: "6px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      "&:hover": {
                        backgroundColor: "grey.100",
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
                style={{ backgroundColor: colorScheme.service}}
              ></span>
              <span>Service</span>
            </div>
            <div className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: colorScheme.method }}
              ></span>
              <span>Method</span>
            </div>
            <div className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: colorScheme.function }}
              ></span>
              <span>Function</span>
            </div>
            {searchTerm && searchTerm.trim() !== "" && (
              <div className="legend-item">
                <span
                  className="legend-color"
                  style={{
                    backgroundColor: "white",
                    border: "4px solid #4caf50",
                    borderRadius: "2px",
                    boxSizing: "border-box",
                  }}
                ></span>
                <span>Search Match</span>
              </div>
            )}
          </div>
        </div>

        {graphData && currentViewType === "logical" && (
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
            jobId={currentJobId}
            searchTerm={searchTerm}
            autoRefresh={autoRefresh}
            setViewType={setCurrentViewType}
            apiService={activeApiService}
          />
        )}
        {currentViewType === "call_stack" && (
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
            jobId={currentJobId}
            searchTerm={searchTerm}
            autoRefresh={autoRefresh}
            setViewType={setCurrentViewType}
            apiService={activeApiService}
          />
        )}
        {graphData && currentViewType === "physical" && (
          <PhysicalVisualization
            ref={physicalVisualizationRef}
            // eslint-disable-next-line
            physicalViewData={physicalViewData!}
            onElementClick={handleElementClick}
            selectedElementId={selectedElementId}
            jobId={currentJobId}
            onUpdate={handleUpdate}
            updating={false}
            searchTerm={searchTerm}
          />
        )}
        {flameData && currentViewType === "flame" && (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              height: "600px",
            }}
          >
            {flameData ? (
              <FlameVisualization
                ref={flameVisualizationRef}
                flameData={flameData}
                onElementClick={handleElementClick}
                selectedElementId={selectedElementId}
                jobId={currentJobId}
                onUpdate={handleUpdate}
                updating={false}
                searchTerm={searchTerm}
                // eslint-disable-next-line
                graphData={graphData!}
                physicalViewData={physicalViewData || undefined}
              />
            ) : (
              <div className="loading-container">
                <p>No flame graph data available</p>
              </div>
            )}
          </div>
        )}
        {currentViewType === "analysis" && (
          <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
            <InsightPanel
              jobId={currentJobId}
              graphData={graphData}
              physicalViewData={physicalViewData}
              flameData={flameData}
              apiService={activeApiService}
            />
          </Box>
        )}
      </Box>
      
      <ElementsPanel
        onElementSelect={handleElementClick}
        selectedElementId={selectedElementId || ""}
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
        onNavigateToLogicalView={(nodeId) => {
          visualizationRef.current?.navigateToView("logical");
          setSelectedElementId(nodeId);
        }}
        isOpen={rightDrawerOpen}
      />
    </Box>
  );
};

export default GraphPage;