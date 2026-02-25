/**
 * Tool Selector component for sketchpad interaction modes
 */

import type { SketchpadTool } from "./types";

interface ToolSelectorProps {
  activeTool: SketchpadTool;
  onToolChange: (tool: SketchpadTool) => void;
}

export function ToolSelector({ activeTool, onToolChange }: ToolSelectorProps) {
  return (
    <div style={{ display: "flex", gap: "5px", marginBottom: "10px" }}>
      <button
        onClick={() => onToolChange("rootSetter")}
        style={{
          padding: "5px 10px",
          backgroundColor: activeTool === "rootSetter" ? "#4caf50" : "#e0e0e0",
          color: activeTool === "rootSetter" ? "white" : "black",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
        title="Click to set the root cell"
      >
        🎯 Root Setter
      </button>
      <button
        onClick={() => onToolChange("neighborhoodViewer")}
        style={{
          padding: "5px 10px",
          backgroundColor: activeTool === "neighborhoodViewer" ? "#2196f3" : "#e0e0e0",
          color: activeTool === "neighborhoodViewer" ? "white" : "black",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
        title="Click to view neighbors (highlights in pink)"
      >
        🔍 Neighborhood Viewer
      </button>
      <button
        onClick={() => onToolChange("blockSetter")}
        style={{
          padding: "5px 10px",
          backgroundColor: activeTool === "blockSetter" ? "#f44336" : "#e0e0e0",
          color: activeTool === "blockSetter" ? "white" : "black",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
        title="Click to toggle vacant/blocked cells"
      >
        ⬛ Block Setter
      </button>
    </div>
  );
}
