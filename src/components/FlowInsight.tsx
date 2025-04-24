import {
  Box,
  CssBaseline,
  CircularProgress,
  ThemeProvider,
  createTheme,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { ApiService } from "../services/api";
import { ElementData, GraphData, PhysicalViewData, FlameGraphData } from "../types";
import GraphPage from "./GraphPage";

// Define the props interface
type FlowInsightProps = {
  baseUrl: string;
  jobId?: string;
  initialViewType?: "logical" | "call_stack" | "physical" | "flame" | "analysis";
  autoRefresh?: boolean;
  refreshInterval?: number;
  authToken?: string;
  onElementClick?: (data: ElementData) => void;
  colorScheme?: Record<string, string>;
}

// Default theme that can be overridden
const defaultTheme = createTheme({
  palette: {
    primary: {
      main: "#3f51b5",
    },
    secondary: {
      main: "#f50057",
    },
  },
  typography: {
    fontFamily: [
      "Roboto",
      "'Helvetica Neue'",
      "Arial",
      "sans-serif",
    ].join(","),
  },
});

/**
 * FlowInsight Component
 * 
 * Main entry point for the Flow Insight library. This component wraps the ServiceGraph
 * component and handles the connection to the backend.
 */
const FlowInsight: React.FC<FlowInsightProps> = ({
  baseUrl,
  jobId,
  initialViewType = "logical",
  autoRefresh = false,
  refreshInterval = 2000,
  authToken,
  onElementClick,
  colorScheme,
}) => {
  const [apiService, setApiService] = useState<ApiService | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [stackGraphData, setStackGraphData] = useState<GraphData | null>(null);
  const [physicalViewData, setPhysicalViewData] = useState<PhysicalViewData | null>(null);
  const [flameData, setFlameData] = useState<FlameGraphData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);

  // Initialize API service
  useEffect(() => {
    try {
      const service = new ApiService({ baseUrl, authToken });
      setApiService(service);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize API service");
    }
  }, [baseUrl, authToken]);

  // Function to fetch all data
  const fetchAllData = useCallback(async () => {
    if (!apiService) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch regular graph data
      const data = await apiService.getGraphData(jobId, false);
      setGraphData(data);

      // Fetch stack graph data
      const stackData = await apiService.getGraphData(jobId, true);
      setStackGraphData(stackData);

      // Fetch physical view data if job ID is provided
      if (jobId) {
        const physicalData = await apiService.getPhysicalViewData(jobId);
        setPhysicalViewData(physicalData);

        // Fetch flame graph data if job ID is provided
        const flameGraphData = await apiService.getFlameGraphData(jobId);
        setFlameData(flameGraphData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, [apiService, jobId]);

  // Initial data fetch
  useEffect(() => {
    if (apiService) {
      fetchAllData();
    }
  }, [apiService, fetchAllData]);

  // Handle auto-refresh
  useEffect(() => {
    if (autoRefresh && apiService) {
      intervalRef.current = setInterval(fetchAllData, refreshInterval);

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [autoRefresh, apiService, fetchAllData, refreshInterval]);

  // Handle element click
  const handleElementClick = useCallback((data: ElementData, skip_zoom = false) => {
    if (data && data.id) {
      setSelectedElementId(data.id);
    }
    
    if (onElementClick) {
      onElementClick(data);
    }
  }, [onElementClick]);

  if (error) {
    return (
      <ThemeProvider theme={defaultTheme}>
        <CssBaseline />
        <Box p={2}>
          {error && <Typography color="error">Error: {error}</Typography>}
        </Box>
      </ThemeProvider>
    );
  }

  if (loading && !graphData) {
    return (
      <ThemeProvider theme={defaultTheme}>
        <CssBaseline />
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          height="100vh"
        >
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={defaultTheme}>
      <CssBaseline />
      <Box sx={{ height: "100%", width: "100%" }}>
        {graphData && (
          <GraphPage
            graphData={graphData}
            stackGraphData={stackGraphData}
            physicalViewData={physicalViewData}
            flameData={flameData}
            jobId={jobId}
            initialViewType={initialViewType}
            autoRefresh={autoRefresh}
            onElementClick={handleElementClick}
            selectedElementId={selectedElementId}
            onUpdate={fetchAllData}
            colorScheme={colorScheme}
            apiService={apiService!}
          />
        )}
      </Box>
    </ThemeProvider>
  );
};

export default FlowInsight; 