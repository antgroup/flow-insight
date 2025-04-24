import React, { useEffect } from "react";
import "./InfoCard.css";
import { BaseNode, FoldedSections, NodeWithCount, NodeWithSpeed, Node } from "../types/infocard";
import { GraphData, Service, Method } from "../types";

type InfoCardProps = {
  data: Node | null;
  visible: boolean;
  graphData: GraphData;
  currentView?: "logical" | "physical" | "flame" | "call_stack" | "analysis";
  onNavigateToLogicalView?: (nodeId: string) => void;
};

// Helper functions to find connected nodes
const findCallInputs = (
  nodeId: string,
  graphData: GraphData,
): NodeWithCount[] => {
  return graphData.callFlows
    .filter((flow) => flow.target === nodeId)
    .map((flow) => {
      const sourceNode = findNodeById(flow.source, graphData);
      return {
        ...sourceNode,
        count: flow.count,
      } as NodeWithCount;
    });
};

const findDataInputs = (
  nodeId: string,
  graphData: GraphData,
): NodeWithSpeed[] => {
  return graphData.dataFlows
    .filter((flow) => flow.target === nodeId)
    .map((flow) => {
      const sourceNode = findNodeById(flow.source, graphData);
      return {
        ...sourceNode,
        speed: flow.speed,
        argpos: flow.argpos,
        duration: flow.duration,
        size: flow.size,
      } as NodeWithSpeed;
    });
};

const findCallOutputs = (
  nodeId: string,
  graphData: GraphData,
): NodeWithCount[] => {
  return graphData.callFlows
    .filter((flow) => flow.source === nodeId)
    .map((flow) => {
      const targetNode = findNodeById(flow.target, graphData);
      return {
        ...targetNode,
        count: flow.count,
      } as NodeWithCount;
    });
};

const findDataOutputs = (
  nodeId: string,
  graphData: GraphData,
): NodeWithSpeed[] => {
  return graphData.dataFlows
    .filter((flow) => flow.source === nodeId)
    .map((flow) => {
      const targetNode = findNodeById(flow.target, graphData);
      return {
        ...targetNode,
        speed: flow.speed,
        argpos: flow.argpos,
        duration: flow.duration,
        size: flow.size,
      } as NodeWithSpeed;
    });
};

// Find a node by ID across all node types
const findNodeById = (id: string, graphData: GraphData): Node => {
  const service = graphData.services.find((service) => service.id === id);
  if (service) {
    return { ...service, type: "service" };
  }

  const method = graphData.methods.find((method) => method.id === id);
  if (method) {
    const service = graphData.services.find((s) => s.id === method.id);
    return {
      ...method,
      type: "method",
      serviceName: service ? service.name : "Unknown Service",
    };
  }

  const func = graphData.functions.find((func) => func.id === id);
  if (func) {
    return { ...func, type: "function" };
  }

  return { id, name: id, type: "function"};
};

// Get all methods for a service
const getServiceMethods = (id: string, graphData: GraphData): Method[] => {
  return graphData.methods
    .filter((method) => method.id === id)
    .map((method) => ({ ...method, type: "method" as const }));
};

// Aggregated connections for a service (include all methods)
const getServiceConnections = (id: string, graphData: GraphData) => {
  const methods = getServiceMethods(id, graphData);
  const methodIds = methods.map((method) => method.id);

  const callInputs: NodeWithCount[] = [];
  const dataInputs: NodeWithSpeed[] = [];
  const callOutputs: NodeWithCount[] = [];
  const dataOutputs: NodeWithSpeed[] = [];

  // Process each method's connections
  methodIds.forEach((methodId) => {
    callInputs.push(...findCallInputs(methodId, graphData));
    dataInputs.push(...findDataInputs(methodId, graphData));
    callOutputs.push(...findCallOutputs(methodId, graphData));
    dataOutputs.push(...findDataOutputs(methodId, graphData));
  });

  // Remove duplicates by ID
  const uniqueCallInputs = Array.from(
    new Map(callInputs.map((item) => [item.id, item])).values(),
  );
  const uniqueDataInputs = Array.from(
    new Map(dataInputs.map((item) => [item.id, item])).values(),
  );
  const uniqueCallOutputs = Array.from(
    new Map(callOutputs.map((item) => [item.id, item])).values(),
  );
  const uniqueDataOutputs = Array.from(
    new Map(dataOutputs.map((item) => [item.id, item])).values(),
  );

  return {
    callInputs: uniqueCallInputs,
    dataInputs: uniqueDataInputs,
    callOutputs: uniqueCallOutputs,
    dataOutputs: uniqueDataOutputs,
    methods,
  };
};

const InfoCard = ({
  data,
  visible,
  graphData,
  currentView = "logical",
  onNavigateToLogicalView,
}: InfoCardProps) => {
  // Add debugging
  useEffect(() => {
    console.log("InfoCard rendering with data:", data);
  }, [data]);

  type SectionKey = keyof FoldedSections;

  // Initialize all sections as folded
  const [foldedSections, setFoldedSections] = React.useState<FoldedSections>({
    Methods: true,
    Devices: true,
    Callers: true,
    Callees: true,
    "Data Dependencies": true,
  });

  // Toggle section fold
  const toggleSection = (title: SectionKey) => {
    setFoldedSections((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  // Render devices section
  const renderDevicesSection = (
    gpuDevices?: Service["gpuDevices"],
  ) => {
    const hasDevices =
      (gpuDevices && gpuDevices.length > 0);

    if (!hasDevices) {
      return (
        <div className="connection-section">
          <div
            className="connection-header"
            onClick={() => toggleSection("Devices")}
          >
            <div className="connection-header-left">
              <span className="fold-icon">
                {foldedSections["Devices"] ? "▶" : "▼"}
              </span>
              <h4>Devices</h4>
            </div>
            <span className="connection-count-badge">(0)</span>
          </div>
          <p className="empty-connection">None</p>
        </div>
      );
    }

    // Function to get color for memory usage
    const getMemoryUsageColor = (usage: number) => {
      if (usage < 0.5) {
        return "#4caf50";
      } // Green for low usage
      if (usage < 0.8) {
        return "#ff9800";
      } // Orange for medium usage
      return "#f44336"; // Red for high usage
    };

    return (
      <div className="connection-section">
        <div
          className="connection-header"
          onClick={() => toggleSection("Devices")}
        >
          <div className="connection-header-left">
            <span className="fold-icon">
              {foldedSections["Devices"] ? "▶" : "▼"}
            </span>
            <h4>Devices</h4>
          </div>
          <span className="connection-count-badge">
            ({(gpuDevices?.length || 0)})
          </span>
        </div>
        {!foldedSections["Devices"] && (
          <div className="device-info-container">
            {gpuDevices && gpuDevices.length > 0 && (
              <div className="device-section">
                <h5>GPU Devices</h5>
                {gpuDevices.map((gpu) => {
                  const memoryUsage = gpu.memoryUsed / gpu.memoryTotal;
                  const memoryUsageColor = getMemoryUsageColor(memoryUsage);

                  return (
                    <div
                      key={gpu.uuid}
                      className="gpu-info"
                      style={{
                        border: "1px solid #e0e0e0",
                        borderRadius: "4px",
                        padding: "12px",
                        marginBottom: "12px",
                        backgroundColor: "#f8f9fa",
                      }}
                    >
                      <div className="info-row" style={{ marginBottom: "8px" }}>
                        <span
                          className="info-label"
                          style={{ fontWeight: "bold" }}
                        >
                          Device {gpu.index}:
                        </span>
                        <span className="info-value">{gpu.name}</span>
                      </div>

                      <div className="info-row" style={{ marginBottom: "8px" }}>
                        <span className="info-label">UUID:</span>
                        <span
                          className="info-value"
                          style={{ fontSize: "0.9em", fontFamily: "monospace" }}
                        >
                          {gpu.uuid}
                        </span>
                      </div>

                      <div className="info-row" style={{ marginBottom: "8px" }}>
                        <span className="info-label">GRAM Usage:</span>
                        <span className="info-value">
                          {Math.round(gpu.memoryUsed)}MB /{" "}
                          {Math.round(gpu.memoryTotal)}MB
                        </span>
                      </div>

                      <div
                        className="memory-usage-bar"
                        style={{
                          width: "100%",
                          height: "8px",
                          backgroundColor: "#e0e0e0",
                          borderRadius: "4px",
                          overflow: "hidden",
                          marginTop: "4px",
                        }}
                      >
                        <div
                          style={{
                            width: `${memoryUsage * 100}%`,
                            height: "100%",
                            backgroundColor: memoryUsageColor,
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>

                      <div
                        className="memory-usage-text"
                        style={{
                          textAlign: "right",
                          fontSize: "0.9em",
                          color: memoryUsageColor,
                          marginTop: "4px",
                        }}
                      >
                        {Math.round(memoryUsage * 100)}% Used
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render methods section
  const renderMethodsSection = (methods: Method[]) => {
    if (!methods || methods.length === 0) {
      return (
        <div className="connection-section">
          <div
            className="connection-header"
            onClick={() => toggleSection("Methods")}
          >
            <div className="connection-header-left">
              <span className="fold-icon">
                {foldedSections["Methods"] ? "▶" : "▼"}
              </span>
              <h4>Methods</h4>
            </div>
            <span className="connection-count-badge">(0)</span>
          </div>
          <p className="empty-connection">None</p>
        </div>
      );
    }

    return (
      <div className="connection-section">
        <div
          className="connection-header"
          onClick={() => toggleSection("Methods")}
        >
          <div className="connection-header-left">
            <span className="fold-icon">
              {foldedSections["Methods"] ? "▶" : "▼"}
            </span>
            <h4>Methods</h4>
          </div>
          <span className="connection-count-badge">({methods.length})</span>
        </div>
        {!foldedSections["Methods"] && (
          <ul className="connection-list">
            {methods.map((method) => (
              <li key={method.id} className="connection-item">
                <div className="connection-main-info">
                  <div>
                    <span className="connection-name">{method.name}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  // Render a list of connected nodes
  const renderConnectedNodes = (
    nodes: (NodeWithCount | NodeWithSpeed)[],
    title: SectionKey,
  ) => {
    if (!nodes || nodes.length === 0) {
      return (
        <div className="connection-section">
          <div
            className="connection-header"
            onClick={() => toggleSection(title)}
          >
            <div className="connection-header-left">
              <span className="fold-icon">
                {foldedSections[title] ? "▶" : "▼"}
              </span>
              <h4>{title}</h4>
            </div>
            <span className="connection-count-badge">(0)</span>
          </div>
          {!foldedSections[title] && <p className="empty-connection">None</p>}
        </div>
      );
    }

    return (
      <div className="connection-section">
        <div className="connection-header" onClick={() => toggleSection(title)}>
          <div className="connection-header-left">
            <span className="fold-icon">
              {foldedSections[title] ? "▶" : "▼"}
            </span>
            <h4>{title}</h4>
          </div>
          <span className="connection-count-badge">({nodes.length})</span>
        </div>
        {!foldedSections[title] && (
          <ul className="connection-list">
            {nodes.map((node, index) => (
              <li key={`${node.id}-${index}`} className="connection-item">
                {node.type === "method" && node.serviceName && (
                  <div className="connection-service-info">
                    <span className="connection-service">
                      Service: {node.serviceName}
                    </span>
                  </div>
                )}

                <div className="connection-divider"></div>

                <div className="connection-main-info">
                  <div>
                    <span className="connection-name">{node.name}</span>
                  </div>
                  {"count" in node && node.count && (
                    <span className="connection-count">{node.count}次</span>
                  )}
                  {"speed" in node && node.speed && (
                    <span className="connection-speed">{node.speed}</span>
                  )}
                </div>

                {/* Display additional data flow information if available */}
                {"speed" in node && title === "Data Dependencies" && (
                  <div className="data-flow-details">
                    <div className="detail-row">
                      <span className="detail-label">Object Type:</span>
                      <span className="detail-value">
                        {node.argpos === undefined
                          ? "val"
                          : node.argpos === -1
                          ? "return val"
                          : node.argpos === -2
                          ? "put"
                          : "argument at " + Math.floor(node.argpos / 2)}
                      </span>
                    </div>
                    {node.size !== undefined && (
                      <div className="detail-row">
                        <span className="detail-label">Size:</span>
                        <span className="detail-value">
                          {node.size.toFixed(8)} MB
                        </span>
                      </div>
                    )}
                    {node.duration !== undefined && (
                      <div className="detail-row">
                        <span className="detail-label">Duration:</span>
                        <span className="detail-value">
                          {node.duration.toFixed(5)} seconds
                        </span>
                      </div>
                    )}
                    {node.duration !== undefined && (
                      <div className="detail-row">
                        <span className="detail-label">Throughput:</span>
                        <span className="detail-value">
                          {node.size !== undefined
                            ? (node.size / node.duration).toFixed(2)
                            : "N/A"}{" "}
                          MB/s
                        </span>
                      </div>
                    )}
                  </div>
                )}

              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderContent = () => {
    if (!data) {
      return (
        <div className="empty-state">Select an element to view details</div>
      );
    }

    switch (data.type) {
      case "service": {
        // Get all information for this service including its methods
        const connections = getServiceConnections(data.id, graphData);

        return (
          <React.Fragment>
            <h3>{data.name}</h3>
            <div className="info-row">
              <span className="info-label">Type:</span>
              <span className="info-value">Service</span>
            </div>
            <div className="info-row">
              <span className="info-label">ID:</span>
              <span className="info-value">{data.id}</span>
            </div>
            {data.state && (
              <div className="info-row">
                <span className="info-label">State:</span>
                <span className="info-value">{data.state}</span>
              </div>
            )}
            {data.pid && (
              <div className="info-row">
                <span className="info-label">PID:</span>
                <span className="info-value">{data.pid}</span>
              </div>
            )}

            {renderDevicesSection(data.gpuDevices || [])}
            {renderMethodsSection(connections.methods)}

            <div className="connections-container">
              {renderConnectedNodes(connections.callInputs, "Callers")}
              {renderConnectedNodes(connections.callOutputs, "Callees")}
              {renderConnectedNodes(
                connections.dataInputs,
                "Data Dependencies",
              )}
            </div>
          </React.Fragment>
        );
      }
      case "method": {
        const callInputs = findCallInputs(data.id, graphData);
        const dataInputs = findDataInputs(data.id, graphData);
        const callOutputs = findCallOutputs(data.id, graphData);
        const service = findNodeById(data.id, graphData) as Service;

        return (
          <React.Fragment>
            <h3>{data.name === "_main" ? "main" : data.name}</h3>
            <div className="info-row">
              <span className="info-label">Type:</span>
              <span className="info-value">Method</span>
            </div>
            <div className="info-row">
              <span className="info-label">Service:</span>
              <span className="info-value">{data.serviceName}</span>
            </div>

            {service && renderDevicesSection(service.gpuDevices || [])}

            <div className="connections-container">
              {renderConnectedNodes(callInputs, "Callers")}
              {renderConnectedNodes(callOutputs, "Callees")}
              {renderConnectedNodes(dataInputs, "Data Dependencies")}
            </div>
          </React.Fragment>
        );
      }
      case "function": {
        const callInputs = findCallInputs(data.id, graphData);
        const dataInputs = findDataInputs(data.id, graphData);
        const callOutputs = findCallOutputs(data.id, graphData);

        return (
          <React.Fragment>
            <h3>{data.name}</h3>
            <div className="info-row">
              <span className="info-label">Type:</span>
              <span className="info-value">Function</span>
            </div>

            <div className="connections-container">
              {renderConnectedNodes(callInputs, "Callers")}
              {renderConnectedNodes(callOutputs, "Callees")}
              {renderConnectedNodes(dataInputs, "Data Dependencies")}
            </div>
          </React.Fragment>
        );
      }
      default:
        const unknownData = data as BaseNode;
        return (
          <div className="default-state">
            <h3>{unknownData.name}</h3>
          </div>
        );
    }
  };

  // The panel is now always visible with a fixed position
  const panelStyle = {
    position: "fixed" as const,
    top: "56px", // Align with elements table
    right: 0,
    height: "calc(100vh - 56px)", // Adjust height to account for top offset
    width: "320px",
    background: "white",
    zIndex: 9999,
    overflowY: "auto" as const,
    borderLeft: "1px solid #e1e4e8",
  };

  return (
    <div className="sidebar-panel" style={panelStyle}>
      <div className="info-panel-content">{renderContent()}</div>
    </div>
  );
};

export default InfoCard;