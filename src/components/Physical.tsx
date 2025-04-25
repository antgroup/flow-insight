import {
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
  } from "@mui/material";
  import * as d3 from "d3";
  import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
  } from "react";
  import { PhysicalViewData, Service, NodeData } from "../types";
  
  // Type for resource values
  type ResourceValue = {
    total: number;
    available: number;
  };
  
  // Define a type for the resource info objects
  type ResourceInfo = {
    available: number;
    total: number;
    used: number;
    usage: number;
  };
  
  // Utility function to extract resource usage from node data
  const extractResourceUsage = (
    resources: Record<string, ResourceValue>,
    pgId: string,
    resourceType: string,
    nodeData?: NodeData,
  ) => {
    // First try the existing resource extraction logic
    // Convert pgId to lowercase for case-insensitive matching
    const pgIdLower = pgId.toLowerCase();
  
    // Find the matching resource key
    const matchingKey = Object.keys(resources).find((key) => {
      if (!key.includes("Group")) {
        return false;
      }
      const [type, id] = key.split("Group");
      return (
        type.toLowerCase() === resourceType.toLowerCase() &&
        id.toLowerCase() === pgIdLower
      );
    });
  
    if (matchingKey) {
      // For GPU resources, calculate memory usage from gpuDevices
      if (resourceType.toLowerCase() === "gpu" && nodeData?.services) {
        // Find all services in this placement group
        let totalMemoryUsed = 0;
        let totalMemoryAvailable = 0;
  
        // Sum up memory usage from all services in this placement group
        Object.values(nodeData.services).forEach((service: Service) => {
          if (service?.placementGroup?.id?.toLowerCase() === pgIdLower) {
            // Check if service has resource_usage field for GPU
            const resourceUsage = getResourceUsageFromField(service, resourceType);
            if (resourceUsage) {
              totalMemoryUsed += resourceUsage.used;
              totalMemoryAvailable += resourceUsage.total;
            } else {
              // Sum up memory from all GPU devices assigned to this service
              service.gpuDevices?.forEach((gpu) => {
                totalMemoryUsed += gpu.memoryUsed;
                totalMemoryAvailable += gpu.memoryTotal;
              });
            }
          }
        });
  
        // If we found any GPU memory usage
        if (totalMemoryAvailable > 0) {
          // Cap usage at 100%
          const usage = Math.min(totalMemoryUsed / totalMemoryAvailable, 1);
  
          return {
            available: Math.max(totalMemoryAvailable - totalMemoryUsed, 0),
            total: totalMemoryAvailable,
            used: totalMemoryUsed,
            usage: usage,
          };
        }
      }
      // For CPU resources, calculate CPU usage from processStats or nodeCpuPercent or resource_usage
      else if (resourceType.toLowerCase() === "cpu" && nodeData?.services) {
        // Find all services in this placement group
        let totalCpuPercent = 0;
        let serviceCount = 0;
        let hasNodeCpuInfo = false;
        let hasResourceUsageInfo = false;
        let totalFromResourceUsage = 0;
  
        // Sum up CPU usage from all services in this placement group
        Object.values(nodeData.services).forEach((service: Service) => {
          if (service?.placementGroup?.id?.toLowerCase() === pgIdLower) {
            // First check if service has resource_usage field for CPU
            const resourceUsage = getResourceUsageFromField(service, resourceType);
            if (resourceUsage) {
              totalCpuPercent += resourceUsage.used;
              totalFromResourceUsage += resourceUsage.total;
              hasResourceUsageInfo = true;
              serviceCount++;
            }
            // If any service has nodeCpuPercent, use that instead
            else if (
              service.nodeCpuPercent !== undefined &&
              !hasResourceUsageInfo
            ) {
              totalCpuPercent = service.nodeCpuPercent;
              hasNodeCpuInfo = true;
              return; // Exit the loop early once we find node CPU info
            }
            // Otherwise use processStats
            else if (
              !hasResourceUsageInfo &&
              service.processStats &&
              service.processStats.cpuPercent !== undefined
            ) {
              totalCpuPercent += service.processStats.cpuPercent;
              serviceCount++;
            }
          }
        });
  
        // If we found any CPU usage
        if (hasResourceUsageInfo || hasNodeCpuInfo || serviceCount > 0) {
          // Cap at 100% for visualization purposes if not using resource_usage
          if (!hasResourceUsageInfo) {
            const cappedUsage = Math.min(totalCpuPercent, 100);
            return {
              available: 100 - cappedUsage,
              total: 100,
              used: totalCpuPercent, // Keep original value for display
              usage: cappedUsage / 100,
            };
          } else {
            // Use values from resource_usage and cap at 100%
            const usage = Math.min(totalCpuPercent / totalFromResourceUsage, 1);
            return {
              available: Math.max(totalFromResourceUsage - totalCpuPercent, 0),
              total: totalFromResourceUsage,
              used: totalCpuPercent,
              usage: usage,
            };
          }
        }
      }
      // For Memory resources, calculate memory usage from processStats or resource_usage
      else if (resourceType.toLowerCase() === "memory" && nodeData?.services) {
        // Find all services in this placement group
        let totalMemoryUsed = 0;
        let memoryTotal = 0;
        let memoryAvailable = 0;
        let hasNodeMemInfo = false;
        let serviceCount = 0;
  
        // First try to get node memory info from any service
        Object.values(nodeData.services).forEach((service: Service) => {
          if (service.nodeMem && service.nodeMem.length >= 4 && !hasNodeMemInfo) {
            memoryTotal = service.nodeMem[0]; // Total memory
            memoryAvailable = service.nodeMem[1]; // Available memory
            hasNodeMemInfo = true;
          }
        });
  
        // If we have node memory info, sum up memory usage from services in this placement group
        if (hasNodeMemInfo) {
          Object.values(nodeData.services).forEach((service: Service) => {
            if (service?.placementGroup?.id?.toLowerCase() === pgIdLower) {
              // First check if service has resource_usage field for Memory
              const resourceUsage = getResourceUsageFromField(
                service,
                resourceType,
              );
              if (resourceUsage) {
                totalMemoryUsed += resourceUsage.used;
                serviceCount++;
              } else if (service.processStats && service.processStats.memoryInfo) {
                totalMemoryUsed += service.processStats.memoryInfo.rss;
                serviceCount++;
              }
            }
          });
  
          // If we found at least one service with memory usage
          if (serviceCount > 0) {
            // Cap usage at 100%
            const usage = Math.min(totalMemoryUsed / memoryTotal, 1);
  
            return {
              available: Math.max(memoryAvailable, 0),
              total: memoryTotal,
              used: totalMemoryUsed,
              usage: usage,
            };
          }
        }
  
        // If no node memory info or no services with memory usage, don't show memory usage
        return null;
      }
      // For custom resources from resource_usage field
      else if (nodeData?.services) {
        let totalUsed = 0;
        let totalAvailable = 0;
        let serviceCount = 0;
  
        // Sum up resource usage from all services in this placement group
        Object.values(nodeData.services).forEach((service: Service) => {
          if (service?.placementGroup?.id?.toLowerCase() === pgIdLower) {
            const resourceUsage = getResourceUsageFromField(service, resourceType);
            if (resourceUsage) {
              totalUsed += resourceUsage.used;
              totalAvailable += resourceUsage.total;
              serviceCount++;
            }
          }
        });
  
        // If we found any resource usage
        if (serviceCount > 0) {
          // Cap usage at 100%
          const usage = Math.min(totalUsed / totalAvailable, 1);
  
          return {
            available: Math.max(totalAvailable - totalUsed, 0),
            total: totalAvailable,
            used: totalUsed,
            usage: usage,
          };
        }
      }
  
      // Fallback to original resource calculation if no specific calculation was done
      const resourceValue = resources[matchingKey];
  
      // Cap usage at 100%
      const used = resourceValue.total - resourceValue.available;
      const usage = Math.min(used / resourceValue.total, 1);
  
      return {
        available: Math.max(resourceValue.available, 0),
        total: resourceValue.total,
        used: used,
        usage: usage,
      };
    }
  
    return null;
  };
  
  // Get available resources for dropdown
  const getAvailableResources = (
    resources: Record<string, ResourceValue>,
    physicalViewData: PhysicalViewData,
  ) => {
    // Start with default resources
    const resourceTypes = [
      {
        key: "GPU",
        label: "GPU Memory",
      },
      {
        key: "GPUUtil",
        label: "GPU Utilization",
      },
      {
        key: "CPU",
        label: "CPU Usage",
      },
      {
        key: "Memory",
        label: "Memory Usage",
      },
    ];
  
    // Add custom resources from resource_usage field
    const customResources = new Set<string>();
  
    if (physicalViewData?.physicalView) {
      Object.values(physicalViewData.physicalView).forEach((nodeData) => {
        if (nodeData?.services) {
          Object.values(nodeData.services).forEach((service: any) => {
            if (service?.resourceUsage) {
              // Add all resource keys from resource_usage
              Object.keys(service.resourceUsage).forEach((key) => {
                customResources.add(key);
              });
            }
          });
        }
      });
    }
  
    // Add custom resources to the list
    customResources.forEach((resource) => {
      // Only add if not already in the list
      if (
        !resourceTypes.some((r) => r.key.toLowerCase() === resource.toLowerCase())
      ) {
        resourceTypes.push({
          key: resource,
          label: `${resource.charAt(0).toUpperCase() + resource.slice(1)} Usage`,
        });
      }
    });
  
    return resourceTypes;
  };
  
  // Utility function to get unique context keys
  const getAvailableContextKeys = (physicalViewData: PhysicalViewData) => {
    const contextKeys = new Set<string>();
    contextKeys.add("instance_id"); // Always add instance_id as an option
    contextKeys.add("service_name"); // Always add service_name as an option
  
    if (physicalViewData?.physicalView) {
      Object.values(physicalViewData.physicalView).forEach((nodeData) => {
        if (nodeData?.services) {
          Object.values(nodeData.services).forEach((service: any) => {
            if (service?.contextInfo) {
              Object.keys(service.contextInfo).forEach((key) =>
                contextKeys.add(key),
              );
            }
          });
        }
      });
    }
  
    return Array.from(contextKeys)
      .sort()
      .map((key) => ({
        key,
        label:
          key === "instance_id"
            ? "Instance ID"
            : key === "service_name"
            ? "Service Name"
            : key,
      }));
  };
  
  // Utility function to get all unique context values for a key
  const getUniqueContextValues = (
    physicalViewData: PhysicalViewData,
    contextKey: string,
  ) => {
    const values = new Set<string>();
  
    if (physicalViewData?.physicalView) {
      Object.values(physicalViewData.physicalView).forEach((nodeData) => {
        if (nodeData?.services) {
          Object.values(nodeData.services).forEach((service: any) => {
            if (contextKey === "instance_id") {
              if (service?.instanceId) {
                values.add(service.instanceId);
              }
            } else if (contextKey === "service_name") {
              if (service?.name) {
                values.add(service.name);
              } else {
                values.add("Unknown");
              }
            } else if (service?.contextInfo?.[contextKey] !== undefined) {
              values.add(service.contextInfo[contextKey].toString());
            }
          });
        }
      });
    }
  
    return Array.from(values);
  };
  
  // Create color scale for context values
  const getContextColorScale = (values: string[]) => {
    const colorScale = d3
      .scaleOrdinal<string>()
      .domain(values)
      .range(d3.schemeCategory10);
    return colorScale;
  };
  
    
  type PhysicalVisualizationProps = {
    physicalViewData: PhysicalViewData;
    onElementClick: (data: any, skip_zoom: boolean) => void;
    selectedElementId: string | null;
    jobId?: string;
    onUpdate?: () => void;
    updating?: boolean;
    searchTerm?: string;
  };
  
  // Add helper functions at the top level, before the PhysicalVisualization component
  // Helper function to calculate GPU usage for a single service
  const getServiceGpuUsage = (service: Service) => {
    if (!service.gpuDevices || service.gpuDevices.length === 0) {
      return null;
    }
  
    let totalMemoryUsed = 0;
    let totalMemoryAvailable = 0;
  
    service.gpuDevices.forEach((gpu) => {
      totalMemoryUsed += gpu.memoryUsed;
      if (totalMemoryAvailable === 0) {
        totalMemoryAvailable = gpu.memoryTotal;
      }
    });
  
    if (totalMemoryAvailable === 0) {
      return null;
    }
  
    // Cap usage at 100%
    const usage = Math.min(totalMemoryUsed / totalMemoryAvailable, 1);
  
    return {
      available: Math.max(totalMemoryAvailable - totalMemoryUsed, 0),
      total: totalMemoryAvailable,
      used: totalMemoryUsed,
      usage: usage,
    };
  };
  
  // Helper function to calculate GPU utilization for a single service
  const getServiceGpuUtilization = (service: Service) => {
    if (!service.gpuDevices || service.gpuDevices.length === 0) {
      return null;
    }
  
    let totalUtilization = 0;
    let deviceCount = 0;
  
    service.gpuDevices.forEach((gpu) => {
      if (gpu.utilization !== undefined) {
        totalUtilization += gpu.utilization;
        deviceCount++;
      }
    });
  
    if (deviceCount === 0) {
      return null;
    }
  
    // Calculate average utilization as a percentage
    const avgUtilization = totalUtilization / deviceCount;
  
    // Cap usage at 100%
    const usage = Math.min(avgUtilization / 100, 1);
  
    return {
      available: 100 - avgUtilization,
      total: 100,
      used: avgUtilization,
      usage: usage,
    };
  };
  
  // Helper function to calculate CPU usage for a single service
  const getServiceCpuUsage = (service: Service) => {
    // Use nodeCpuPercent if available
    if (service.nodeCpuPercent !== undefined) {
      const cpuPercent = service.nodeCpuPercent;
  
      // Cap usage at 100%
      const cappedPercent = Math.min(cpuPercent, 100);
  
      return {
        available: 100 - cappedPercent,
        total: 100,
        used: cpuPercent, // Keep original value for display
        usage: cappedPercent / 100,
      };
    }
  
    if (!service.processStats || service.processStats.cpuPercent === undefined) {
      return null;
    }
  
    const cpuPercent = service.processStats.cpuPercent;
  
    // Cap usage at 100%
    const cappedPercent = Math.min(cpuPercent, 100);
  
    return {
      available: 100 - cappedPercent,
      total: 100,
      used: cpuPercent, // Keep original value for display
      usage: cappedPercent / 100,
    };
  };
  
  // Helper function to calculate memory usage for a single service
  const getServiceMemoryUsage = (service: Service) => {
    if (!service.processStats || !service.processStats.memoryInfo) {
      return null;
    }
  
    // Only use nodeMem if available - no estimation
    if (service.nodeMem && service.nodeMem.length >= 4) {
      const memoryUsed = service.processStats.memoryInfo.rss;
      const memoryTotal = service.nodeMem[0]; // Total memory
      const memoryAvailable = service.nodeMem[1]; // Available memory
  
      // Cap usage at 100%
      const usage = Math.min(memoryUsed / memoryTotal, 1);
  
      return {
        available: Math.max(memoryAvailable, 0),
        total: memoryTotal,
        used: memoryUsed,
        usage: usage,
      };
    }
  
    // If we don't have node memory information, return null
    return null;
  };
  
  // Helper function to calculate node-level GPU usage
  const getNodeGpuUsage = (nodeData: NodeData) => {
    if (!nodeData.gpus || nodeData.gpus.length === 0) {
      return null;
    }
  
    let totalMemoryUsed = 0;
    let totalMemoryAvailable = 0;
  
    nodeData.gpus.forEach((gpu) => {
      totalMemoryUsed += gpu.memoryUsed;
      totalMemoryAvailable += gpu.memoryTotal;
    });
  
    if (totalMemoryAvailable === 0) {
      return null;
    }
  
    // Cap usage at 100%
    const usage = Math.min(totalMemoryUsed / totalMemoryAvailable, 1);
  
    return {
      available: Math.max(totalMemoryAvailable - totalMemoryUsed, 0),
      total: totalMemoryAvailable,
      used: totalMemoryUsed,
      usage: usage,
    };
  };
  
  // Helper function to calculate node-level CPU usage
  const getNodeCpuUsage = (nodeData: NodeData) => {
    if (!nodeData.services) {
      return null;
    }
  
    let totalCpuPercent = 0;
    let serviceCount = 0;
    let hasNodeCpuInfo = false;
  
    Object.values(nodeData.services).forEach((service) => {
      // If any service has nodeCpuPercent, use that instead of summing individual CPU usages
      if (service.nodeCpuPercent !== undefined) {
        totalCpuPercent = service.nodeCpuPercent;
        hasNodeCpuInfo = true;
        return; // Exit the loop early once we find node CPU info
      }
  
      if (service.processStats && service.processStats.cpuPercent !== undefined) {
        totalCpuPercent += service.processStats.cpuPercent;
        serviceCount++;
      }
    });
  
    if (!hasNodeCpuInfo && serviceCount === 0) {
      return null;
    }
  
    // Cap at 100% for visualization purposes
    const cappedUsage = Math.min(totalCpuPercent, 100);
  
    return {
      available: 100 - cappedUsage,
      total: 100,
      used: totalCpuPercent, // Keep original value for display
      usage: cappedUsage / 100,
    };
  };
  
  // Helper function to calculate node-level memory usage
  const getNodeMemoryUsage = (nodeData: NodeData) => {
    if (!nodeData.services) {
      return null;
    }
  
    let hasNodeMemInfo = false;
    let memoryTotal = 0;
    let memoryAvailable = 0;
  
    // Try to get node memory info from any service
    Object.values(nodeData.services).forEach((service) => {
      if (service.nodeMem && service.nodeMem.length >= 4 && !hasNodeMemInfo) {
        memoryTotal = service.nodeMem[0]; // Total memory
        memoryAvailable = service.nodeMem[1]; // Available memory
        hasNodeMemInfo = true;
      }
    });
  
    if (hasNodeMemInfo) {
      const memoryUsed = memoryTotal - memoryAvailable;
  
      // Cap usage at 100%
      const usage = Math.min(memoryUsed / memoryTotal, 1);
  
      return {
        available: Math.max(memoryAvailable, 0),
        total: memoryTotal,
        used: memoryUsed,
        usage: usage,
      };
    }
  
    // If no node memory info, don't show memory usage
    return null;
  };
  
  // Helper function to calculate node-level GPU utilization
  const getNodeGpuUtilization = (nodeData: NodeData) => {
    if (!nodeData.gpus || nodeData.gpus.length === 0) {
      // Try accessing gpu utilization from services instead
      if (nodeData.services) {
        let totalUtilization = 0;
        let deviceCount = 0;
  
        Object.values(nodeData.services).forEach((service) => {
          if (service.gpuDevices) {
            service.gpuDevices.forEach((gpu) => {
              if (gpu.utilization !== undefined) {
                totalUtilization += gpu.utilization;
                deviceCount++;
              }
            });
          }
        });
  
        if (deviceCount > 0) {
          const avgUtilization = totalUtilization / deviceCount;
          const usage = Math.min(avgUtilization / 100, 1);
  
          return {
            available: 100 - avgUtilization,
            total: 100,
            used: avgUtilization,
            usage: usage,
          };
        }
      }
      return null;
    }
  
    let totalUtilization = 0;
    let deviceCount = 0;
  
    nodeData.gpus.forEach((gpu) => {
      if (gpu.utilizationGpu !== undefined) {
        totalUtilization += gpu.utilizationGpu;
        deviceCount++;
      }
    });
  
    if (deviceCount === 0) {
      return null;
    }
  
    // Calculate average utilization as a percentage
    const avgUtilization = totalUtilization / deviceCount;
  
    // Cap usage at 100%
    const usage = Math.min(avgUtilization / 100, 1);
  
    return {
      available: 100 - avgUtilization,
      total: 100,
      used: avgUtilization,
      usage: usage,
    };
  };
  
  // Helper function to check if service or node has resource info
  const hasResourceInfo = (
    data: Service | NodeData,
    resourceType: string,
  ): boolean => {
    if (resourceType.toLowerCase() === "gpu") {
      if ((data as Service).gpuDevices) {
        return ((data as Service).gpuDevices?.length ?? 0) > 0;
      }
      if ((data as NodeData).gpus) {
        return ((data as NodeData).gpus?.length ?? 0) > 0;
      }
    } else if (resourceType.toLowerCase() === "gpuutil") {
      if ((data as Service).gpuDevices) {
        return (
          (data as Service).gpuDevices?.some(
            (gpu) => gpu.utilization !== undefined,
          ) ?? false
        );
      }
      if ((data as NodeData).gpus) {
        return (
          (data as NodeData).gpus?.some(
            (gpu) => gpu.utilizationGpu !== undefined,
          ) ?? false
        );
      }
      if ((data as NodeData).services) {
        return Object.values((data as NodeData).services).some(
          (service) =>
            service.gpuDevices?.some((gpu) => gpu.utilization !== undefined) ??
            false,
        );
      }
    } else if (resourceType.toLowerCase() === "cpu") {
      if ((data as Service).processStats) {
        return (data as Service).processStats?.cpuPercent !== undefined;
      }
      if ((data as NodeData).services) {
        return Object.values((data as NodeData).services).some(
          (service) => service.processStats?.cpuPercent !== undefined,
        );
      }
    } else if (resourceType.toLowerCase() === "memory") {
      // Update memory check to only require processStats.memoryInfo
      if ((data as Service).processStats) {
        return (data as Service).processStats?.memoryInfo?.rss !== undefined;
      }
      if ((data as NodeData).services) {
        return Object.values((data as NodeData).services).some(
          (service) => service.processStats?.memoryInfo?.rss !== undefined,
        );
      }
    }
  
    // Check for custom resources in resourceUsage field
    if ((data as Service).resourceUsage) {
      return (data as Service).resourceUsage?.[resourceType] !== undefined;
    }
  
    return false;
  };
  
  // Constants for service dimensions
  const SERVICE_HEIGHT = 24; // Fixed height for all services
  const SERVICE_WIDTH = SERVICE_HEIGHT * 6; // Width is 6 times the height
  
  // Extend this to include an exportSvg method
  export type PhysicalVisualizationHandle = {
    exportSvg: () => void;
  };
  
  const PhysicalVisualization = forwardRef<
    PhysicalVisualizationHandle,
    PhysicalVisualizationProps
  >(
    (
      {
        physicalViewData,
        onElementClick,
        selectedElementId,
        jobId,
        onUpdate,
        updating = false,
        searchTerm = "",
      },
      ref,
    ) => {
      const svgRef = useRef<SVGSVGElement | null>(null);
      const containerRef = useRef<HTMLDivElement>(null);
      const zoomRef =
        useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
      const graphRef =
        useRef<d3.Selection<SVGGElement, unknown, null, any> | null>(null);
      const [selectedResource, setSelectedResource] = useState<string>("GPU");
      const [selectedContext, setSelectedContext] =
        useState<string>("service_name");
      const [contextValueFilter, setContextValueFilter] = useState<string>("");
      const legendRef = useRef<SVGGElement | null>(null);
  
      // Move colors into useMemo
      const colors = useMemo(
        () => ({
          node: "#e8f5e9",
          nodeStroke: "#2e7d32",
          placementGroup: "#bbdefb",
          placementGroupStroke: "#1976d2",
          freeServices: "#ffecb3",
          freeServicesStroke: "#ff8f00",
          service: "#c5e1a5",
          serviceStroke: "#558b2f",
          selectedElement: "#ff5722",
          serviceSection: "#ffffff",
          serviceSectionStroke: "#90caf9",
        }),
        [],
      );
  
      const renderLegend = useCallback(
        (contextKey: string) => {
          if (!svgRef.current || !physicalViewData) {
            return;
          }
  
          // Remove existing legend
          if (legendRef.current) {
            d3.select(legendRef.current).remove();
          }
  
          const svg = d3.select(svgRef.current);
          const values = getUniqueContextValues(physicalViewData, contextKey);
          const colorScale = getContextColorScale(values);
  
          // Create a foreign object to hold the HTML-based legend
          const svgHeight = parseInt(svg.style("height"));
          const legendWidth = 200;
          const legendHeight = Math.min(300, svgHeight - 70); // Cap height and allow scrolling
          const legendX = 20;
          const legendY = 50;
  
          // Add legend container as a foreignObject for HTML content
          const foreignObject = svg
            .append("foreignObject")
            .attr("x", legendX - 10)
            .attr("y", legendY - 25)
            .attr("width", legendWidth + 20)
            .attr("height", legendHeight + 30);
  
          // Keep a reference to be able to remove it later
          legendRef.current = foreignObject.node() as SVGGElement;
  
          // Create HTML content for the legend
          const legendDiv = foreignObject
            .append("xhtml:div")
            .style("width", "100%")
            .style("height", "100%")
            .style("background", "white")
            .style("border", "1px solid #ccc")
            .style("border-radius", "5px")
            .style("padding", "10px")
            .style("box-sizing", "border-box");
  
          // Add legend title
          legendDiv
            .append("xhtml:div")
            .style("font-size", "12px")
            .style("font-weight", "bold")
            .style("margin-bottom", "10px")
            .text(contextKey === "instance_id" ? "Instance ID" : contextKey);
  
          // Create scrollable container for legend items
          const itemsContainer = legendDiv
            .append("xhtml:div")
            .style("max-height", `${legendHeight - 40}px`) // Reduce max-height to ensure scrolling works
            .style("overflow-y", "auto")
            .style("overflow-x", "hidden")
            .style("padding-right", "5px") // Add padding for scrollbar
            .style("margin-right", "-5px") // Offset padding to maintain alignment
            .on("wheel", (event) => {
              // Prevent scroll events from propagating to the SVG
              event.stopPropagation();
            })
            .on("mousewheel", (event) => {
              // For older browsers
              event.stopPropagation();
            })
            .on("DOMMouseScroll", (event) => {
              // For Firefox
              event.stopPropagation();
            });
  
          // Add legend items vertically
          values.forEach((value) => {
            const itemDiv = itemsContainer
              .append("xhtml:div")
              .style("display", "flex")
              .style("align-items", "center")
              .style("padding", "4px 0")
              .style("white-space", "nowrap")
              .style("text-overflow", "ellipsis");
  
            // Color box
            itemDiv
              .append("xhtml:div")
              .style("width", "15px")
              .style("height", "15px")
              .style("background-color", colorScale(value))
              .style("border", "0.5px solid #ccc")
              .style("flex-shrink", "0");
  
            // Text with tooltip
            itemDiv
              .append("xhtml:div")
              .style("margin-left", "8px")
              .style("overflow", "hidden")
              .style("text-overflow", "ellipsis")
              .style("font-size", "12px")
              .style("width", "calc(100% - 23px)") // Fixed width to ensure overflow works
              .attr("title", value) // Add tooltip
              .text(value);
          });
  
          // Add search match legend item if there's a search term
          if (searchTerm && searchTerm.trim() !== "") {
            const searchItemDiv = itemsContainer
              .append("xhtml:div")
              .style("display", "flex")
              .style("align-items", "center")
              .style("padding", "4px 0")
              .style("margin-top", "5px");
  
            // Color box for search matches
            searchItemDiv
              .append("xhtml:div")
              .style("width", "15px")
              .style("height", "15px")
              .style("background-color", "white")
              .style("border", "2px solid #4caf50")
              .style("border-style", "dashed")
              .style("flex-shrink", "0");
  
            // Text for search matches
            searchItemDiv
              .append("xhtml:div")
              .style("margin-left", "8px")
              .style("font-size", "12px")
              .text("Search Match");
          }
        },
        [physicalViewData, searchTerm],
      );
  
      // Function to check if an service matches the search term
      const serviceMatchesSearch = useCallback(
        (service: Service): boolean => {
          if (!searchTerm || searchTerm.trim() === "") {
            return false;
          }
  
          const searchTermLower = searchTerm.toLowerCase();
  
          // Check instance ID
          if (
            service.instanceId &&
            service.instanceId.toLowerCase().includes(searchTermLower)
          ) {
            return true;
          }
  
          // Check service name
          if (service.name && service.name.toLowerCase().includes(searchTermLower)) {
            return true;
          }
  
          // Check context info
          if (service.contextInfo) {
            for (const key in service.contextInfo) {
              const value = service.contextInfo[key];
              if (
                value &&
                value.toString().toLowerCase().includes(searchTermLower)
              ) {
                return true;
              }
            }
          }
  
          return false;
        },
        [searchTerm],
      );
  
      // Function to check if a service matches the context value filter
      const serviceMatchesContextFilter = useCallback(
        (service: Service): boolean => {
          if (!contextValueFilter || contextValueFilter.trim() === "") {
            return true; // No filter applied, all services match
          }
  
          const filterLower = contextValueFilter.toLowerCase();
  
          let contextValue: string | undefined;
          if (selectedContext === "instance_id") {
            contextValue = service.instanceId;
          } else if (selectedContext === "service_name") {
            contextValue = service.name || "Unknown";
          } else {
            contextValue = service.contextInfo?.[selectedContext]?.toString();
          }
  
          // If context value is undefined or doesn't match the filter, return false
          return (
            contextValue !== undefined &&
            contextValue.toLowerCase().includes(filterLower)
          );
        },
        [contextValueFilter, selectedContext],
      );
  
      // Add a filter definition for the glow effect
      const addGlowFilter = useCallback(
        (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) => {
          // Remove any existing filter
          svg.select("defs").remove();
  
          // Create defs element for filters
          const defs = svg.append("defs");
  
          // Create filter for glow effect
          const filter = defs
            .append("filter")
            .attr("id", "glow-effect")
            .attr("x", "-50%")
            .attr("y", "-50%")
            .attr("width", "200%")
            .attr("height", "200%");
  
          // Add blur effect
          filter
            .append("feGaussianBlur")
            .attr("stdDeviation", "3")
            .attr("result", "blur");
  
          // Add color matrix to make the glow green
          filter
            .append("feColorMatrix")
            .attr("in", "blur")
            .attr("type", "matrix")
            .attr(
              "values",
              "0 0 0 0 0.298 0 0 0 0 0.686 0 0 0 0 0.314 0 0 0 1 0",
            );
  
          // Merge the original with the glow
          const feMerge = filter.append("feMerge");
          feMerge.append("feMergeNode").attr("in", "colorMatrix");
          feMerge.append("feMergeNode").attr("in", "SourceGraphic");
        },
        [],
      );
  
      const renderPhysicalView = useCallback(() => {
        if (!svgRef.current || !physicalViewData) {
          return;
        }
  
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
  
        // Add glow filter
        addGlowFilter(svg);
  
        // Set up zoom behavior with better constraints
        const zoom = d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.1, 2])
          .on("zoom", (event) => {
            inner.attr("transform", event.transform);
          });
  
        zoomRef.current = zoom;
        svg.call(zoom);
  
        // Create the main group element
        const inner = svg.append("g");
        graphRef.current = inner;
  
        // Get nodes from physical view data
        const nodes = Object.entries(physicalViewData.physicalView || {});
        if (nodes.length === 0) {
          return;
        }
  
        // Calculate layout dimensions
        const svgWidth = parseInt(svg.style("width"));
        const svgHeight = parseInt(svg.style("height"));
        const nodeMargin = 50;
  
        // Calculate vertical layout (single column)
        const rows = nodes.length;
  
        // Get color scale for current context
        const contextValues = getUniqueContextValues(
          physicalViewData,
          selectedContext,
        );
        const contextColorScale = getContextColorScale(contextValues);
  
        // Update the service coloring
        const getServiceColor = (service: Service): string => {
          if (!service) {
            return "#cccccc";
          }
  
          let contextValue;
          if (selectedContext === "instance_id") {
            contextValue = service.instanceId;
          } else if (selectedContext === "service_name") {
            contextValue = service.name || "Unknown";
          } else {
            contextValue = service.contextInfo?.[selectedContext]?.toString();
          }
  
          return contextValue ? contextColorScale(contextValue) : "#cccccc";
        };
  
        // Calculate maximum node width based on services
        let maxNodeWidth = 0;
        nodes.forEach(([_, nodeData]) => {
          let nodeWidth = 0;
  
          // Group all placement groups by ID
          const placementGroups: { [pgId: string]: Service[] } = {};
          const freeServices: Service[] = [];
  
          // Categorize services
          if (nodeData?.services) {
            Object.values(nodeData.services).forEach((service) => {
              // Skip services that don't match the context value filter
              if (!serviceMatchesContextFilter(service)) {
                return;
              }
  
              if (service?.placementGroup?.id) {
                const pgId = service.placementGroup.id;
                if (!placementGroups[pgId]) {
                  placementGroups[pgId] = [];
                }
                placementGroups[pgId].push(service);
              } else {
                freeServices.push(service);
              }
            });
          }
  
          // Calculate width for each placement group
          Object.values(placementGroups).forEach((services) => {
            // Calculate width based on fixed service dimensions and margins
            const pgWidth =
              services.length * SERVICE_WIDTH + (services.length - 1) * 8 + 40; // Add margins and padding
            nodeWidth = Math.max(nodeWidth, pgWidth);
          });
  
          // Calculate width for free services
          if (freeServices.length > 0) {
            // Calculate width based on fixed service dimensions and margins
            const freeServicesWidth =
              freeServices.length * SERVICE_WIDTH + (freeServices.length - 1) * 8 + 40; // Add margins and padding
            nodeWidth = Math.max(nodeWidth, freeServicesWidth);
          }
  
          // Ensure minimum node width
          nodeWidth = Math.max(nodeWidth, 200);
          maxNodeWidth = Math.max(maxNodeWidth, nodeWidth);
        });
  
        // Use maxNodeWidth for layout calculations
        const contentWidth = maxNodeWidth + 2 * nodeMargin;
  
        // Calculate node heights dynamically based on content
        const nodeHeights: number[] = [];
        nodes.forEach(([_, nodeData]) => {
          // Group all placement groups by ID
          const placementGroups: { [pgId: string]: Service[] } = {};
          const freeServices: Service[] = [];
  
          // Categorize services
          if (nodeData?.services) {
            Object.values(nodeData.services).forEach((service) => {
              // Skip services that don't match the context value filter
              if (!serviceMatchesContextFilter(service)) {
                return;
              }
  
              if (service?.placementGroup?.id) {
                const pgId = service.placementGroup.id;
                if (!placementGroups[pgId]) {
                  placementGroups[pgId] = [];
                }
                placementGroups[pgId].push(service);
              } else {
                freeServices.push(service);
              }
            });
          }
  
          const pgKeys = Object.keys(placementGroups);
          const hasFreeServices = freeServices.length > 0;
          const totalGroups = pgKeys.length + (hasFreeServices ? 1 : 0);
  
          if (totalGroups === 0) {
            nodeHeights.push(200); // Default height for empty nodes
            return;
          }
  
          // Constants for height calculation
          const headerHeight = 40; // Space for node header
          const serviceBoxHeight = SERVICE_HEIGHT + 16; // Fixed height plus padding
          const serviceResourceBarMargin = 4;
          const groupSpacing = 14; // Spacing between groups
          const topMargin = 10; // Top margin inside node
  
          // Calculate height for placement groups
          const pgTotalHeight =
            pgKeys.length *
            (serviceBoxHeight + serviceResourceBarMargin + groupSpacing);
  
          // Calculate height for free services if present
          const freeServicesHeight = hasFreeServices
            ? serviceBoxHeight + serviceResourceBarMargin
            : 0;
  
          // Calculate total node height
          const totalNodeHeight =
            headerHeight + pgTotalHeight + freeServicesHeight + topMargin;
  
          // Ensure minimum node height
          nodeHeights.push(Math.max(totalNodeHeight, 200));
        });
  
        // Use the maximum node height for layout calculations
        const maxNodeHeight = Math.max(...nodeHeights);
        const contentHeight = rows * (maxNodeHeight + nodeMargin) + nodeMargin;
  
        // Calculate required scale to fit everything
        const scaleX = svgWidth / contentWidth;
        const scaleY = svgHeight / contentHeight;
        const finalScale = Math.min(scaleX, scaleY, 1) * 0.9;
  
        // Center coordinates
        const centerX = svgWidth / 2;
        const centerY = svgHeight / 2;
  
        // Draw nodes with vertical positioning
        nodes.forEach(([nodeId, nodeData], index) => {
          // Skip nodes that don't have any services matching the context value filter
          if (contextValueFilter && contextValueFilter.trim() !== "") {
            const hasMatchingServices = Object.values(nodeData?.services || {}).some(
              (service) => serviceMatchesContextFilter(service),
            );
            if (!hasMatchingServices) {
              return;
            }
          }
  
          const x = nodeMargin; // Fixed x position for vertical layout
          const y = index * (maxNodeHeight + nodeMargin) + nodeMargin;
  
          // Group all placement groups by ID
          const placementGroups: { [pgId: string]: Service[] } = {};
          const freeServices: Service[] = [];
  
          // Categorize services
          if (nodeData?.services) {
            Object.values(nodeData.services).forEach((service) => {
              // Skip services that don't match the context value filter
              if (!serviceMatchesContextFilter(service)) {
                return;
              }
  
              if (service?.placementGroup?.id) {
                const pgId = service.placementGroup.id;
                if (!placementGroups[pgId]) {
                  placementGroups[pgId] = [];
                }
                placementGroups[pgId].push(service);
              } else {
                freeServices.push(service);
              }
            });
          }
  
          const pgKeys = Object.keys(placementGroups);
          const hasFreeServices = freeServices.length > 0;
          const totalGroups = pgKeys.length + (hasFreeServices ? 1 : 0);
  
          // Use the calculated height for this node
          const nodeHeight = nodeHeights[index];
  
          // Draw node rectangle
          const nodeGroup = inner
            .append("g")
            .attr("transform", `translate(${x}, ${y})`)
            .attr("class", "node")
            .attr("data-id", nodeId)
  
          // Get node-level GPU usage if resource is selected
          let nodeGpuInfo: ResourceInfo | null = null;
          if (selectedResource && selectedResource.toLowerCase() === "gpu") {
            nodeGpuInfo = getNodeGpuUsage(nodeData);
          }
  
          // Get node-level CPU usage if resource is selected
          let nodeCpuInfo: ResourceInfo | null = null;
          if (selectedResource && selectedResource.toLowerCase() === "cpu") {
            nodeCpuInfo = getNodeCpuUsage(nodeData);
          }
  
          // Get node-level memory usage if resource is selected
          let nodeMemoryInfo: ResourceInfo | null = null;
          if (selectedResource && selectedResource.toLowerCase() === "memory") {
            nodeMemoryInfo = getNodeMemoryUsage(nodeData);
          }
  
          // Draw the background rectangle (empty part)
          nodeGroup
            .append("rect")
            .attr("width", maxNodeWidth)
            .attr("height", nodeHeight)
            .attr("rx", 5)
            .attr("ry", 5)
            .attr("fill", "#f5f5f5") // Light background for empty part
            .attr(
              "stroke",
              selectedElementId === nodeId
                ? colors.selectedElement
                : colors.nodeStroke,
            )
            .attr("stroke-width", selectedElementId === nodeId ? 3 : 1);
  
          // Draw the filled part based on resource usage
          if (nodeGpuInfo && nodeGpuInfo.usage > 0) {
            nodeGroup
              .append("rect")
              .attr("width", maxNodeWidth * nodeGpuInfo.usage)
              .attr("height", nodeHeight)
              .attr("rx", 5)
              .attr("ry", 5)
              .attr("fill", colors.node)
              .attr("stroke", "none");
  
            // Add dashed line divider at the boundary
            nodeGroup
              .append("line")
              .attr("x1", maxNodeWidth * nodeGpuInfo.usage)
              .attr("y1", 0)
              .attr("x2", maxNodeWidth * nodeGpuInfo.usage)
              .attr("y2", nodeHeight)
              .attr("stroke", "#666")
              .attr("stroke-width", 1)
              .attr("stroke-dasharray", "4,2");
          } else if (
            selectedResource &&
            selectedResource.toLowerCase() === "gpuutil"
          ) {
            // Get node-level GPU utilization if resource is selected
            const nodeGpuUtilInfo = getNodeGpuUtilization(nodeData);
            if (nodeGpuUtilInfo && nodeGpuUtilInfo.usage > 0) {
              nodeGroup
                .append("rect")
                .attr("width", maxNodeWidth * nodeGpuUtilInfo.usage)
                .attr("height", nodeHeight)
                .attr("rx", 5)
                .attr("ry", 5)
                .attr("fill", colors.node)
                .attr("stroke", "none");
  
              // Add dashed line divider at the boundary
              nodeGroup
                .append("line")
                .attr("x1", maxNodeWidth * nodeGpuUtilInfo.usage)
                .attr("y1", 0)
                .attr("x2", maxNodeWidth * nodeGpuUtilInfo.usage)
                .attr("y2", nodeHeight)
                .attr("stroke", "#666")
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "4,2");
            }
          } else if (nodeCpuInfo && nodeCpuInfo.usage > 0) {
            nodeGroup
              .append("rect")
              .attr("width", maxNodeWidth * nodeCpuInfo.usage)
              .attr("height", nodeHeight)
              .attr("rx", 5)
              .attr("ry", 5)
              .attr("fill", colors.node)
              .attr("stroke", "none");
  
            // Add dashed line divider at the boundary
            nodeGroup
              .append("line")
              .attr("x1", maxNodeWidth * nodeCpuInfo.usage)
              .attr("y1", 0)
              .attr("x2", maxNodeWidth * nodeCpuInfo.usage)
              .attr("y2", nodeHeight)
              .attr("stroke", "#666")
              .attr("stroke-width", 1)
              .attr("stroke-dasharray", "4,2");
          } else if (nodeMemoryInfo && nodeMemoryInfo.usage > 0) {
            nodeGroup
              .append("rect")
              .attr("width", maxNodeWidth * nodeMemoryInfo.usage)
              .attr("height", nodeHeight)
              .attr("rx", 5)
              .attr("ry", 5)
              .attr("fill", colors.node)
              .attr("stroke", "none");
  
            // Add dashed line divider at the boundary
            nodeGroup
              .append("line")
              .attr("x1", maxNodeWidth * nodeMemoryInfo.usage)
              .attr("y1", 0)
              .attr("x2", maxNodeWidth * nodeMemoryInfo.usage)
              .attr("y2", nodeHeight)
              .attr("stroke", "#666")
              .attr("stroke-width", 1)
              .attr("stroke-dasharray", "4,2");
          }
  
          // Node label
          nodeGroup
            .append("text")
            .attr("x", 10)
            .attr("y", 20)
            .attr("font-weight", "bold")
            .text(`Node: ${nodeId.substring(0, 8)}...`);
  
          if (totalGroups === 0) {
            return;
          }
  
          const resourceBarMargin = 12; // Reduced margin
          const pgWidth = maxNodeWidth - 20 - resourceBarMargin;
  
          // Constants for layout
          const headerHeight = 40; // Space for node header
          const serviceBoxHeight = SERVICE_HEIGHT + 16; // Fixed height plus padding
          const serviceResourceBarMargin = 4;
          const groupSpacing = 14; // Spacing between groups
  
          // Calculate total height for each placement group
          const pgTotalHeight = serviceBoxHeight + serviceResourceBarMargin;
  
          // Use the new rendering functions with all required parameters
          renderPlacementGroups(
            nodeGroup,
            placementGroups,
            pgKeys,
            nodeData,
            headerHeight, // Start after header
            pgWidth,
            pgTotalHeight,
            colors,
            selectedResource,
            selectedElementId,
            onElementClick,
            getServiceColor,
            serviceMatchesSearch,
            searchTerm,
            groupSpacing, // Pass group spacing as parameter
            selectedContext,
          );
  
          // Calculate Y position for free services
          const freeServicesY =
            headerHeight +
            (pgKeys.length > 0
              ? pgKeys.length * (pgTotalHeight + groupSpacing)
              : 0);
  
          renderFreeServices(
            nodeGroup,
            freeServices,
            freeServicesY,
            pgWidth,
            pgTotalHeight,
            colors,
            selectedElementId,
            onElementClick,
            getServiceColor,
            serviceMatchesSearch,
            selectedResource,
            searchTerm,
            selectedContext,
          );
        });
  
        // After all nodes are drawn, center the visualization
        svg.call(
          zoom.transform,
          d3.zoomIdentity
            .translate(centerX, centerY)
            .scale(finalScale)
            .translate(-contentWidth / 2, -contentHeight / 2),
        );
  
        // Set viewBox to contain the graph
        svg.attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  
        // Render legend after graph
        renderLegend(selectedContext);
  
        // Ensure search highlights are visible by raising them to the top
        if (searchTerm && searchTerm.trim() !== "") {
          svg.selectAll("rect[stroke='#4caf50']").raise();
        }
      }, [
        physicalViewData,
        selectedElementId,
        onElementClick,
        selectedResource,
        selectedContext,
        renderLegend,
        colors,
        serviceMatchesSearch,
        searchTerm,
        addGlowFilter,
        serviceMatchesContextFilter,
        contextValueFilter, // Add contextValueFilter to dependency array
      ]);
  
      // Initial render and on data change
      useEffect(() => {
        renderPhysicalView();
      }, [renderPhysicalView, physicalViewData, contextValueFilter]);
  
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
        svgCopy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        svgCopy.setAttribute("width", svgElement.clientWidth.toString());
        svgCopy.setAttribute("height", svgElement.clientHeight.toString());
  
        // Convert to a string
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgCopy);
  
        // Create a blob from the SVG string
        const blob = new Blob([svgString], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
  
        // Create a download link and trigger the download
        const a = document.createElement("a");
        a.href = url;
        a.download = `physical-visualization-${new Date()
          .toISOString()
          .slice(0, 10)}.svg`;
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
          className="visualization-container"
          style={{ display: "flex", flexDirection: "column" }}
        >
          <div
            className="graph-container"
            style={{ flex: "1 1 auto", position: "relative" }}
          >
            <svg ref={svgRef} width="100%" height="600"></svg>
            <div
              className="resource-selector"
              style={{
                position: "absolute",
                top: "10px",
                right: "100px",
                padding: "10px",
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: "10px",
                backgroundColor: "rgba(245, 245, 245, 0.9)",
                borderRadius: "4px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                zIndex: 10,
              }}
            >
              <FormControl size="small" style={{ width: "150px" }}>
                <InputLabel>Resource Type</InputLabel>
                <Select
                  value={selectedResource}
                  onChange={(e) => setSelectedResource(e.target.value)}
                  label="Resource Type"
                  sx={{
                    "& .MuiSelect-select": {
                      paddingRight: "32px !important",
                    },
                  }}
                  IconComponent={() => (
                    <div
                      style={{
                        position: "absolute",
                        right: "7px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M7 10l5 5 5-5z" />
                      </svg>
                    </div>
                  )}
                >
                  {getAvailableResources(
                    physicalViewData.physicalView?.[
                      Object.keys(physicalViewData.physicalView)[0]
                    ]?.resources || {},
                    physicalViewData,
                  ).map(({ key, label }) => (
                    <MenuItem key={key} value={key}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" style={{ width: "150px" }}>
                <InputLabel>Context</InputLabel>
                <Select
                  value={selectedContext}
                  onChange={(e) => {
                    setSelectedContext(e.target.value);
                    setContextValueFilter(""); // Reset filter when context changes
                  }}
                  label="Context"
                  sx={{
                    "& .MuiSelect-select": {
                      paddingRight: "32px !important",
                    },
                  }}
                  IconComponent={() => (
                    <div
                      style={{
                        position: "absolute",
                        right: "7px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M7 10l5 5 5-5z" />
                      </svg>
                    </div>
                  )}
                >
                  {getAvailableContextKeys(physicalViewData).map(
                    ({ key, label }) => (
                      <MenuItem key={key} value={key}>
                        {label}
                      </MenuItem>
                    ),
                  )}
                </Select>
              </FormControl>
              <FormControl size="small" style={{ width: "150px" }}>
                <TextField
                  label="Filter Context Value"
                  value={contextValueFilter}
                  onChange={(e) => setContextValueFilter(e.target.value)}
                  placeholder={`Filter by ${selectedContext}`}
                  variant="outlined"
                  size="small"
                />
              </FormControl>
            </div>
          </div>
        </div>
      );
    },
  );
  
  // Helper function to get context value for an service (move before renderPlacementGroups)
  const getServiceContextValue = (service: Service, contextKey: string): string => {
    if (contextKey === "instance_id") {
      return service.instanceId || "unknown";
    } else if (contextKey === "service_name") {
      return service.name || "Unknown";
    } else if (service.contextInfo && service.contextInfo[contextKey] !== undefined) {
      return service.contextInfo[contextKey].toString();
    }
    return "Unknown";
  };
  
  // Update renderPlacementGroups signature to include selectedContext
  const renderPlacementGroups = (
    nodeGroup: any,
    placementGroups: Record<string, Service[]>,
    pgKeys: string[],
    nodeData: NodeData,
    pgY: number,
    pgWidth: number,
    pgHeight: number,
    colors: any,
    selectedResource: string,
    selectedElementId: string | null,
    onElementClick: (data: any, skip_zoom: boolean) => void,
    getServiceColor: (service: Service) => string,
    serviceMatchesSearchFn: (service: Service) => boolean,
    searchTerm: string | undefined,
    groupSpacing: number,
    selectedContext: string,
  ) => {
    const serviceMargin = 8; // Add margin between services
    const topMargin = 4; // Add top margin
    const serviceResourceBarMargin = 4; // Margin between service and its resource bar
    const pgPadding = 20; // Padding inside placement group (10px on each side)
  
    // Available width for placement groups (accounting for node padding)
    const availableWidth = pgWidth - pgPadding;
  
    pgKeys.forEach((pgId, pgIndex) => {
      const services = placementGroups[pgId];
      const currentY = pgY + pgIndex * (pgHeight + groupSpacing); // Increased spacing
  
      // Calculate total width needed for all services including margins
      const totalServicesWidth =
        services.length * SERVICE_WIDTH + (services.length - 1) * serviceMargin;
  
      // Calculate scale fservice if total width exceeds available width
      let containerWidth = totalServicesWidth + 20; // Add some padding
      let scaleFservice = 1;
  
      if (containerWidth > availableWidth) {
        scaleFservice = availableWidth / containerWidth;
        containerWidth = availableWidth;
      }
  
      // Calculate the total height needed for the placement group
      const serviceBoxHeight = SERVICE_HEIGHT + 16; // Fixed height plus padding
      const totalPGHeight = serviceBoxHeight + serviceResourceBarMargin;
  
      // Placement group rectangle
      const pgGroup = nodeGroup
        .append("g")
        .attr("transform", `translate(10, ${currentY + topMargin})`)
        .attr("class", "placement-group")
        .attr("data-id", pgId);
  
      // Get placement group resource usage if a resource is selected
      let resourceInfo: ResourceInfo | null = null;
      if (selectedResource) {
        resourceInfo = extractResourceUsage(
          nodeData.resources,
          pgId,
          selectedResource,
          nodeData,
        );
      }
  
      // Draw the background rectangle (empty part)
      pgGroup
        .append("rect")
        .attr("width", containerWidth)
        .attr("height", totalPGHeight)
        .attr("rx", 3)
        .attr("ry", 3)
        .attr("fill", "#f5f5f5") // Light background for empty part
        .attr("stroke", colors.placementGroupStroke)
        .attr("stroke-width", 1);
  
      // Draw the filled part based on resource usage
      if (resourceInfo && resourceInfo.usage > 0) {
        pgGroup
          .append("rect")
          .attr("width", containerWidth * resourceInfo.usage)
          .attr("height", totalPGHeight)
          .attr("rx", 3)
          .attr("ry", 3)
          .attr("fill", colors.placementGroup)
          .attr("stroke", "none");
  
        // Add dashed line divider at the boundary
        pgGroup
          .append("line")
          .attr("x1", containerWidth * resourceInfo.usage)
          .attr("y1", 0)
          .attr("x2", containerWidth * resourceInfo.usage)
          .attr("y2", totalPGHeight)
          .attr("stroke", "#666")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "4,2");
      }
  
      // Calculate starting X position to center services
      const startX = (containerWidth - totalServicesWidth * scaleFservice) / 2;
  
      // Draw service sections
      let currentX = startX;
      services.forEach((service: Service, serviceIndex: number) => {
        if (!service) {
          return;
        }
        service.id = service.instanceId;
  
        const serviceWidth = SERVICE_WIDTH * scaleFservice;
  
        // Create clickable section group
        const sectionGroup = pgGroup
          .append("g")
          .attr("transform", `translate(${currentX}, 0)`)
          .attr("class", "service-section")
          .attr("data-id", service.instanceId || "unknown")
          .on("click", (event: any) => {
            event.stopPropagation();
            onElementClick(
              {
                id: service.instanceId || "unknown",
                type: "service",
                name: service.name || `Service${serviceIndex + 1}`,
                gpuDevices: service.gpuDevices || [],
                state: service.state,
                pid: service.pid,
                nodeId: service.nodeId,
                requiredResources: service.requiredResources,
                data: service,
              },
              true,
            );
          });
  
        // Calculate service dimensions with padding
        const padding = 8;
        const serviceHeight = SERVICE_HEIGHT;
  
        // Get service-level resource usage based on selected resource type
        let serviceResourceInfo: ResourceInfo | null = null;
        if (selectedResource) {
          if (
            selectedResource.toLowerCase() === "gpu" &&
            hasResourceInfo(service, "gpu")
          ) {
            serviceResourceInfo = getServiceGpuUsage(service);
          } else if (
            selectedResource.toLowerCase() === "gpuutil" &&
            hasResourceInfo(service, "gpuutil")
          ) {
            serviceResourceInfo = getServiceGpuUtilization(service);
          } else if (
            selectedResource.toLowerCase() === "cpu" &&
            hasResourceInfo(service, "cpu")
          ) {
            serviceResourceInfo = getServiceCpuUsage(service);
          } else if (
            selectedResource.toLowerCase() === "memory" &&
            hasResourceInfo(service, "memory")
          ) {
            serviceResourceInfo = getServiceMemoryUsage(service);
          } else if (hasResourceInfo(service, selectedResource)) {
            // Use getResourceUsageFromField for custom resources
            serviceResourceInfo = getResourceUsageFromField(
              service,
              selectedResource,
            );
          }
        }
  
        // Draw service background (empty part)
        sectionGroup
          .append("rect")
          .attr("x", 0)
          .attr("y", padding)
          .attr("width", serviceWidth)
          .attr("height", serviceHeight)
          .attr("fill", "#f5f5f5") // Light background for empty part
          .attr("opacity", searchTerm && !serviceMatchesSearchFn(service) ? 0.3 : 1)
          .attr("stroke", "none")
          .attr("rx", 2)
          .attr("ry", 2);
  
        // Draw filled part based on resource usage
        if (serviceResourceInfo && serviceResourceInfo.usage > 0) {
          sectionGroup
            .append("rect")
            .attr("x", 0)
            .attr("y", padding)
            .attr("width", serviceWidth * serviceResourceInfo.usage)
            .attr("height", serviceHeight)
            .attr("fill", getServiceColor(service))
            .attr(
              "opacity",
              searchTerm && !serviceMatchesSearchFn(service) ? 0.3 : 0.7,
            )
            .attr("stroke", "none")
            .attr("rx", 2)
            .attr("ry", 2);
  
          // Add dashed line divider at the boundary
          sectionGroup
            .append("line")
            .attr("x1", serviceWidth * serviceResourceInfo.usage)
            .attr("y1", padding)
            .attr("x2", serviceWidth * serviceResourceInfo.usage)
            .attr("y2", padding + serviceHeight)
            .attr("stroke", "#666")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "3,2");
        }
  
        // Create a clipping path for text
        const clipId = `service-text-clip-${pgId}-${serviceIndex}`;
        sectionGroup
          .append("clipPath")
          .attr("id", clipId)
          .append("rect")
          .attr("width", serviceWidth - 4) // Slight padding
          .attr("height", serviceHeight);
  
        // Add service label with clipping
        sectionGroup
          .append("text")
          .attr("x", serviceWidth / 2)
          .attr("y", serviceHeight / 2 + padding)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "middle")
          .attr("font-size", "10px")
          .attr("fill", "#000000")
          .attr("clip-path", `url(#${clipId})`)
          .text(getServiceContextValue(service, selectedContext))
          .append("title") // Add tooltip for full context value
          .text(getServiceContextValue(service, selectedContext));
  
        // Add search highlight border if service matches search
        if (serviceMatchesSearchFn(service)) {
          sectionGroup
            .append("rect")
            .attr("x", 0)
            .attr("y", padding)
            .attr("width", serviceWidth)
            .attr("height", serviceHeight)
            .attr("fill", "none")
            .attr("stroke", "#4caf50")
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "4,2")
            .attr("class", "search-highlight")
            .style("pointer-events", "none")
            .attr("rx", 2)
            .attr("ry", 2);
        }
  
        // Update currentX to include margin for next service
        currentX += serviceWidth + serviceMargin;
      });
    });
  };
  
  // Update renderFreeServices signature to include selectedContext
  const renderFreeServices = (
    nodeGroup: any,
    freeServices: Service[],
    freeServicesY: number,
    pgWidth: number,
    pgHeight: number,
    colors: any,
    selectedElementId: string | null,
    onElementClick: (data: any, skip_zoom: boolean) => void,
    getServiceColor: (service: Service) => string,
    serviceMatchesSearchFn: (service: Service) => boolean,
    selectedResource: string,
    searchTerm: string | undefined,
    selectedContext: string,
  ) => {
    if (freeServices.length === 0) {
      return;
    }
  
    const serviceMargin = 8;
    const topMargin = 4;
    const groupSpacing = 0; // Add consistent spacing
    const pgPadding = 20; // Padding inside free services group (10px on each side)
  
    // Available width for free services (accounting for node padding)
    const availableWidth = pgWidth - pgPadding;
  
    // Adjust the starting Y position to account for the increased spacing
    const adjustedFreeServicesY = freeServicesY + groupSpacing;
  
    const freeServicesGroup = nodeGroup
      .append("g")
      .attr("transform", `translate(10, ${adjustedFreeServicesY + topMargin})`)
      .attr("class", "free-services");
  
    // Calculate total width needed for all free services including margins
    const totalServicesWidth =
      freeServices.length * SERVICE_WIDTH + (freeServices.length - 1) * serviceMargin;
  
    // Calculate scale fservice if total width exceeds available width
    let containerWidth = totalServicesWidth + 20; // Add some padding
    let scaleFservice = 1;
  
    if (containerWidth > availableWidth) {
      scaleFservice = availableWidth / containerWidth;
      containerWidth = availableWidth;
    }
  
    // Calculate starting X position to center services
    const startX = (containerWidth - totalServicesWidth * scaleFservice) / 2;
  
    // Draw free service sections
    let currentX = startX;
    freeServices.forEach((service, serviceIndex) => {
      if (!service) {
        return;
      }
  
      const serviceWidth = SERVICE_WIDTH * scaleFservice;
  
      // Create clickable section group
      const sectionGroup = freeServicesGroup
        .append("g")
        .attr("transform", `translate(${currentX}, 0)`)
        .attr("class", "service-section")
        .attr("data-id", service.instanceId || "unknown")
        .on("click", (event: any) => {
          event.stopPropagation();
          onElementClick(
            {
              id: service.instanceId || "unknown",
              type: "service",
              name: service.name || `Service${serviceIndex + 1}`,
              gpuDevices: service.gpuDevices || [],
              state: service.state,
              pid: service.pid,
              nodeId: service.nodeId,
              requiredResources: service.requiredResources,
              data: service,
            },
            true,
          );
        });
  
      // Calculate service dimensions with padding
      const padding = 0;
      const serviceHeight = SERVICE_HEIGHT;
  
      // Get service-level resource usage based on selected resource type
      let serviceResourceInfo: ResourceInfo | null = null;
      if (selectedResource) {
        if (
          selectedResource.toLowerCase() === "gpu" &&
          hasResourceInfo(service, "gpu")
        ) {
          serviceResourceInfo = getServiceGpuUsage(service);
        } else if (
          selectedResource.toLowerCase() === "gpuutil" &&
          hasResourceInfo(service, "gpuutil")
        ) {
          serviceResourceInfo = getServiceGpuUtilization(service);
        } else if (
          selectedResource.toLowerCase() === "cpu" &&
          hasResourceInfo(service, "cpu")
        ) {
          serviceResourceInfo = getServiceCpuUsage(service);
        } else if (
          selectedResource.toLowerCase() === "memory" &&
          hasResourceInfo(service, "memory")
        ) {
          serviceResourceInfo = getServiceMemoryUsage(service);
        } else if (hasResourceInfo(service, selectedResource)) {
          // Use getResourceUsageFromField for custom resources
          serviceResourceInfo = getResourceUsageFromField(service, selectedResource);
        }
      }
  
      // Draw service background (empty part)
      sectionGroup
        .append("rect")
        .attr("x", 0)
        .attr("y", padding)
        .attr("width", serviceWidth)
        .attr("height", serviceHeight)
        .attr("fill", "#f5f5f5") // Light background for empty part
        .attr("opacity", searchTerm && !serviceMatchesSearchFn(service) ? 0.3 : 1)
        .attr("stroke", "none")
        .attr("rx", 2)
        .attr("ry", 2);
  
      // Draw filled part based on resource usage
      if (serviceResourceInfo && serviceResourceInfo.usage > 0) {
        sectionGroup
          .append("rect")
          .attr("x", 0)
          .attr("y", padding)
          .attr("width", serviceWidth * serviceResourceInfo.usage)
          .attr("height", serviceHeight)
          .attr("fill", getServiceColor(service))
          .attr("opacity", searchTerm && !serviceMatchesSearchFn(service) ? 0.3 : 0.7)
          .attr("stroke", "none")
          .attr("rx", 2)
          .attr("ry", 2);
  
        // Add dashed line divider at the boundary
        sectionGroup
          .append("line")
          .attr("x1", serviceWidth * serviceResourceInfo.usage)
          .attr("y1", padding)
          .attr("x2", serviceWidth * serviceResourceInfo.usage)
          .attr("y2", padding + serviceHeight)
          .attr("stroke", "#666")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "3,2");
      }
  
      // Create a clipping path for text
      const clipId = `free-service-text-clip-${serviceIndex}`;
      sectionGroup
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", serviceWidth - 4) // Slight padding
        .attr("height", serviceHeight);
  
      // Add service label with clipping
      sectionGroup
        .append("text")
        .attr("x", serviceWidth / 2)
        .attr("y", serviceHeight / 2 + padding)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", "10px")
        .attr("fill", "#000000")
        .attr("clip-path", `url(#${clipId})`)
        .text(getServiceContextValue(service, selectedContext))
        .append("title") // Add tooltip for full context value
        .text(getServiceContextValue(service, selectedContext));
  
      // Add search highlight border if service matches search
      if (serviceMatchesSearchFn(service)) {
        sectionGroup
          .append("rect")
          .attr("x", 0)
          .attr("y", padding)
          .attr("width", serviceWidth)
          .attr("height", serviceHeight)
          .attr("fill", "none")
          .attr("stroke", "#4caf50")
          .attr("stroke-width", 2)
          .attr("stroke-dasharray", "4,2")
          .attr("class", "search-highlight")
          .style("pointer-events", "none")
          .attr("rx", 2)
          .attr("ry", 2);
      }
  
      // Update currentX to include margin for next service
      currentX += serviceWidth + serviceMargin;
    });
  };
  
  // Add a new helper function to get resource usage from resource_usage field
  const getResourceUsageFromField = (service: Service, resourceType: string): any => {
    if (!service.resourceUsage) {
      return null;
    }
  
    // Check if the requested resource exists in the usage data
    if (!service.resourceUsage[resourceType]) {
      return null;
    }
  
    const resourceData = service.resourceUsage[resourceType];
    const usageValue = resourceData.used;
    const baseResource = resourceData.base;
    let total = 0;
  
    // Get total based on the base field
    if (
      baseResource.toLowerCase() === "gpu" &&
      service.gpuDevices &&
      service.gpuDevices.length > 0
    ) {
      // Use GPU memory as total
      total = service.gpuDevices[0].memoryTotal;
    } else if (baseResource.toLowerCase() === "cpu") {
      // Use 100 as total for CPU percentage
      total = 100;
    } else if (
      baseResource.toLowerCase() === "memory" &&
      service.nodeMem &&
      service.nodeMem.length >= 1
    ) {
      // Use node memory as total
      total = service.nodeMem[0];
    } else if (baseResource.toLowerCase() === resourceType.toLowerCase()) {
      // If base is the same as resource type, assume usage is a percentage
      total = 100;
    } else {
      // Default case: assume usage is absolute and use 100 as total
      total = 100;
    }
  
    if (total === 0) {
      return null;
    }
  
    // Calculate usage percentage and cap at 100%
    const usagePercentage = Math.min(usageValue / total, 1);
  
    return {
      available: Math.max(total - usageValue, 0),
      total: total,
      used: usageValue,
      usage: usagePercentage,
    };
  };
  
  export default PhysicalVisualization;