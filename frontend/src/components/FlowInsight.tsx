import {
  Box,
  CssBaseline,
  CircularProgress,
  ThemeProvider,
  createTheme,
  Typography,
} from '@mui/material';
import React, { useCallback, useEffect, useState, useRef } from 'react';

import { ApiService } from '../services/api';
import { ElementData, GraphData, PhysicalViewData, FlameGraphData } from '../types';
import GraphPage from './GraphPage';

// Define the props interface
type FlowInsightProps = {
  baseUrl: string;
  flowId?: string;
  initialViewType?: 'logical' | 'call_stack' | 'physical' | 'flame' | 'analysis';
  refreshInterval?: number;
  authToken?: string;
  onElementClick?: (data: ElementData) => void;
  colorScheme?: Record<string, string>;
};

// Default theme that can be overridden
const defaultTheme = createTheme({
  palette: {
    primary: {
      main: '#3f51b5',
    },
    secondary: {
      main: '#f50057',
    },
  },
  typography: {
    fontFamily: ['Roboto', "'Helvetica Neue'", 'Arial', 'sans-serif'].join(','),
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
  flowId,
  initialViewType = 'logical',
  refreshInterval = 2000,
  authToken,
  onElementClick,
  colorScheme,
}) => {
  const [apiService, setApiService] = useState<ApiService | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize API service
  useEffect(() => {
    try {
      const service = new ApiService({ baseUrl, authToken });
      setApiService(service);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize API service');
    }
  }, [baseUrl, authToken]);

  if (error) {
    return (
      <ThemeProvider theme={defaultTheme}>
        <CssBaseline />
        <Box p={2}>{error && <Typography color="error">Error: {error}</Typography>}</Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={defaultTheme}>
      <CssBaseline />
      <Box sx={{ height: '100%', width: '100%' }}>
        <GraphPage
          flowId={flowId}
          initialViewType={initialViewType}
          onElementClick={onElementClick}
          colorScheme={colorScheme}
          apiService={apiService!}
        />
      </Box>
    </ThemeProvider>
  );
};

export default FlowInsight;
