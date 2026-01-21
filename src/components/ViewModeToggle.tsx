import React from "react";
import type { GridSolution } from "../solver";

type ViewMode = "sketchpad" | "solution";

interface ViewModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  solution: GridSolution | null;
  onCopyToSketchpad?: () => void;
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  viewMode,
  onViewModeChange,
  solution,
  onCopyToSketchpad,
}) => {
  return (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        gap: "8px",
        marginBottom: "8px",
      }}>
        <span style={{ fontWeight: "bold", fontSize: "14px" }}>Viewing:</span>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            onClick={() => onViewModeChange("sketchpad")}
            style={{
              padding: "6px 12px",
              backgroundColor: viewMode === "sketchpad" ? "#3498db" : "#ecf0f1",
              color: viewMode === "sketchpad" ? "white" : "#2c3e50",
              border: "1px solid #bdc3c7",
              borderRadius: "4px 0 0 4px",
              cursor: "pointer",
              fontWeight: viewMode === "sketchpad" ? "bold" : "normal",
            }}
          >
            Sketchpad
          </button>
          <button
            onClick={() => onViewModeChange("solution")}
            style={{
              padding: "6px 12px",
              backgroundColor: viewMode === "solution" ? "#27ae60" : "#ecf0f1",
              color: viewMode === "solution" ? "white" : "#2c3e50",
              border: "1px solid #bdc3c7",
              borderRadius: "0 4px 4px 0",
              cursor: "pointer",
              fontWeight: viewMode === "solution" ? "bold" : "normal",
            }}
          >
            SAT Solution
          </button>
        </div>
        {viewMode === "solution" && solution && onCopyToSketchpad && (
          <button
            onClick={onCopyToSketchpad}
            style={{
              padding: "6px 12px",
              marginLeft: "8px",
              backgroundColor: "#16a085",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Copy to Sketchpad
          </button>
        )}
      </div>
      <p style={{ 
        fontSize: "12px", 
        color: "#7f8c8d", 
        margin: "0",
        fontStyle: "italic",
      }}>
        {viewMode === "sketchpad" 
          ? "Editing sketchpad (user colors). Click cells to paint." 
          : solution 
            ? "Viewing SAT-generated solution (read-only)."
            : "No SAT solution available yet. Click Solve to generate one."}
      </p>
    </div>
  );
};
