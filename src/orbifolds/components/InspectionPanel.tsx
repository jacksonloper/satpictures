import { formatVoltageRows, type OrbifoldEdgeId } from "../orbifoldbasics";
import type { InspectionInfo } from "./OrbifoldGridTools";

interface InspectionPanelProps {
  inspectionInfo: InspectionInfo;
  onEdgeLinestyleToggle: (edgeId: OrbifoldEdgeId) => void;
}

export function InspectionPanel({
  inspectionInfo,
  onEdgeLinestyleToggle,
}: InspectionPanelProps) {
  return (
    <div style={{ 
      marginTop: "16px", 
      padding: "12px", 
      backgroundColor: "#ebf5fb",
      borderRadius: "8px",
      border: "1px solid #3498db",
      maxWidth: "400px",
    }}>
      <h4 style={{ marginBottom: "8px", color: "#2980b9" }}>
        🔍 Node Inspection
      </h4>
      <p style={{ fontSize: "13px", marginBottom: "8px" }}>
        <strong>Node ID:</strong> <code style={{ backgroundColor: "#fff", padding: "2px 4px" }}>{inspectionInfo.nodeId}</code>
      </p>
      <p style={{ fontSize: "13px", marginBottom: "8px" }}>
        <strong>Coordinates:</strong> ({inspectionInfo.coord[0]}, {inspectionInfo.coord[1]})
      </p>
      <p style={{ fontSize: "13px", marginBottom: "4px" }}>
        <strong>Edges ({inspectionInfo.edges.length}):</strong>
      </p>
      <div style={{ 
        maxHeight: "200px", 
        overflowY: "auto",
        fontSize: "12px",
        fontFamily: "monospace",
      }}>
        {inspectionInfo.edges.map((edge, idx) => (
          <div 
            key={idx} 
            style={{ 
              marginBottom: "8px", 
              padding: "6px",
              backgroundColor: "white",
              borderRadius: "4px",
            }}
          >
            <div><strong>Edge ID:</strong> <code style={{ backgroundColor: "#f0f0f0", padding: "1px 3px", fontSize: "11px" }}>{edge.edgeId}</code></div>
            <div><strong>→ Target:</strong> {edge.targetNodeId} ({edge.targetCoord[0]},{edge.targetCoord[1]})</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
              <strong>Linestyle:</strong>
              <button
                onClick={() => onEdgeLinestyleToggle(edge.edgeId)}
                style={{
                  padding: "2px 8px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  border: "1px solid #3498db",
                  backgroundColor: edge.linestyle === "dashed" ? "#ebf5fb" : "white",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <svg width="24" height="8" style={{ verticalAlign: "middle" }}>
                  <line
                    x1="2"
                    y1="4"
                    x2="22"
                    y2="4"
                    stroke="#3498db"
                    strokeWidth="2"
                    strokeDasharray={edge.linestyle === "dashed" ? "4,3" : undefined}
                  />
                </svg>
                {edge.linestyle}
              </button>
            </div>
            <div><strong>Voltage:</strong></div>
            {formatVoltageRows(edge.voltage).map((row, rowIdx) => (
              <div key={rowIdx} style={{ marginLeft: "10px" }}>{row}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
