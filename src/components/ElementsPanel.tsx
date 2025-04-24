import React, { useCallback, useEffect, useState } from "react";
import "./ElementsPanel.css";
import { GraphData } from "../types";

type ElementsPanelProps = {
  onElementSelect: (element: any) => void;
  selectedElementId: string | null;
  graphData: GraphData;
  onSearchChange?: (searchTerm: string) => void;
};

const ElementsPanel = ({
  onElementSelect,
  selectedElementId,
  graphData,
  onSearchChange,
}: ElementsPanelProps) => {
  const [activeTab, setActiveTab] = useState("services");
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedServices, setExpandedServices] = useState<Record<string, boolean>>(
    {},
  );

  // Notify parent component when search term changes
  useEffect(() => {
    if (onSearchChange) {
      onSearchChange(searchTerm);
    }
  }, [searchTerm, onSearchChange]);

  // Filter items based on search term
  const filterItems = useCallback(
    (items: any[]) => {
      if (!searchTerm) {
        return items;
      }
      return items.filter(
        (item) =>
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.id.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    },
    [searchTerm],
  );

  // Get methods for a specific service
  const getServiceMethods = useCallback(
    (instanceId: string) => {
      const methods = graphData.methods.filter(
        (method) => method.instanceId === instanceId,
      );
      if (!searchTerm) {
        return methods;
      }

      return methods.filter(
        (method) =>
          method.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          method.id.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    },
    [graphData.methods, searchTerm],
  );

  // Filter services and their methods based on search term
  const filterServicesAndMethods = useCallback(() => {
    if (!searchTerm) {
      return graphData.services;
    }

    return graphData.services.filter((service) => {
      const serviceMatches =
        service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        service.id.toLowerCase().includes(searchTerm.toLowerCase());

      const serviceMethods = getServiceMethods(service.id);
      const methodMatches = serviceMethods.some(
        (method) =>
          method.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          method.id.toLowerCase().includes(searchTerm.toLowerCase()),
      );

      return serviceMatches || methodMatches;
    });
  }, [searchTerm, graphData.services, getServiceMethods]);

  // Update expanded services when search term changes
  useEffect(() => {
    const servicesToExpand: Record<string, boolean> = {};
    graphData.services.forEach((service) => {
      const methods = getServiceMethods(service.id);
      // Only expand if there's a search term and methods exist
      servicesToExpand[service.id] = searchTerm !== "" && methods.length > 0;
    });
    setExpandedServices(servicesToExpand);
  }, [searchTerm, getServiceMethods, graphData.services]);

  const filteredServices = filterServicesAndMethods();
  const filteredFunctions = filterItems(graphData.functions);

  // Toggle expanded state for an service
  const toggleServiceExpand = (instanceId: string) => {
    setExpandedServices((prev) => ({
      ...prev,
      [instanceId]: !prev[instanceId],
    }));
  };

  return (
    <div className="elements-panel">
      <div className="elements-header">
        <h3>Instances</h3>
        <div className="search-container">
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      <div className="tab-container">
        <div
          className={`tab ${activeTab === "services" ? "active" : ""}`}
          onClick={() => setActiveTab("services")}
        >
          Services ({graphData.services.length})
        </div>
        <div
          className={`tab ${activeTab === "functions" ? "active" : ""}`}
          onClick={() => setActiveTab("functions")}
        >
          Functions ({graphData.functions.length})
        </div>
      </div>

      <div className="elements-table-container">
        {activeTab === "services" && (
          <table className="elements-table">
            <thead>
              <tr>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((service) => (
                <React.Fragment key={service.id}>
                  <tr
                    className={`service-row ${
                      service.id === selectedElementId ? "selected" : ""
                    }`}
                  >
                    <td>
                      <button
                        className={`expand-button ${
                          expandedServices[service.id] ? "expanded" : ""
                        }`}
                        onClick={() => toggleServiceExpand(service.id)}
                      >
                        {expandedServices[service.id] ? "−" : "+"}
                      </button>
                      <span
                        onClick={() =>
                          onElementSelect({ ...service, type: "service" })
                        }
                      >
                        {service.name}
                      </span>
                    </td>
                  </tr>
                  {expandedServices[service.id] && (
                    <tr className="methods-container">
                      <td>
                        <div className="service-methods">
                          <table className="methods-table">
                            <tbody>
                              {getServiceMethods(service.id).map((method) => (
                                <tr
                                  key={method.id}
                                  className={
                                    method.id === selectedElementId
                                      ? "selected"
                                      : ""
                                  }
                                  onClick={() =>
                                    onElementSelect({
                                      ...method,
                                      type: "method",
                                    })
                                  }
                                >
                                  <td>{method.name}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "functions" && (
          <table className="elements-table">
            <thead>
              <tr>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              {filteredFunctions.map((func) => (
                <tr
                  key={func.id}
                  className={func.id === selectedElementId ? "selected" : ""}
                  onClick={() => onElementSelect({ ...func, type: "function" })}
                >
                  <td>{func.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ElementsPanel;