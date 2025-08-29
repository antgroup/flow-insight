import React, { useState } from 'react';
import { FlowInsight } from '@ant-ray/flow-insight';

function App() {
  const [flowId, setFlowId] = useState('demo-flow');
  const [currentFlowId, setCurrentFlowId] = useState('demo-flow');

  const handleFlowIdSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (flowId.trim()) {
      setCurrentFlowId(flowId.trim());
    }
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Flow ID Input Header */}
      <div style={{
        padding: '16px',
        backgroundColor: '#f5f5f5',
        borderBottom: '1px solid #d9d9d9',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <form onSubmit={handleFlowIdSubmit} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          maxWidth: '800px'
        }}>
          <label style={{
            fontWeight: 'bold',
            fontSize: '14px',
            minWidth: '60px'
          }}>
            Flow ID:
          </label>
          <input
            type="text"
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
            placeholder="Enter flow ID (e.g., demo-flow)"
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: '4px',
              fontSize: '14px',
              fontFamily: 'monospace'
            }}
          />
          <button
            type="submit"
            style={{
              padding: '8px 16px',
              backgroundColor: '#1890ff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold'
            }}
            onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#40a9ff')}
            onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#1890ff')}
          >
            Load Flow
          </button>
          <div style={{
            fontSize: '12px',
            color: '#666',
            padding: '4px 8px',
            backgroundColor: '#e6f7ff',
            borderRadius: '4px',
            border: '1px solid #91d5ff'
          }}>
            Current: <strong>{currentFlowId}</strong>
          </div>
        </form>
      </div>

      {/* Flow Insight Component */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <FlowInsight
          baseUrl='/'
          flowId={currentFlowId}
          key={currentFlowId} // Force re-render when flow ID changes
        />
      </div>
    </div>
  );
}

export default App; 