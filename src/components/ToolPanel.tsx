import { ColorPalette } from "./ColorPalette";
import type { PathlengthConstraint } from "../problem";

export type EditingTool = "colors" | "roots" | "distance";

interface ToolPanelProps {
  editingTool: EditingTool;
  onToolChange: (tool: EditingTool) => void;
  selectedColor: number | null;
  onColorSelect: (color: number | null) => void;
  numColors: number;
  pathlengthConstraints: PathlengthConstraint[];
}

export function ToolPanel({
  editingTool,
  onToolChange,
  selectedColor,
  onColorSelect,
  numColors,
  pathlengthConstraints,
}: ToolPanelProps) {
  return (
    <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "#ecf0f1", borderRadius: "6px" }}>
      <div style={{ fontSize: "13px", color: "#7f8c8d", marginBottom: "8px" }}>
        <strong>Tool:</strong>{" "}
        {editingTool === "colors" && "Click cells to paint colors"}
        {editingTool === "roots" && "Click a colored cell to set its root"}
        {editingTool === "distance" && "Click a cell to set minimum distance from root"}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={() => onToolChange("colors")}
          style={{
            padding: "6px 12px",
            backgroundColor: editingTool === "colors" ? "#3498db" : "#bdc3c7",
            color: editingTool === "colors" ? "white" : "#2c3e50",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: editingTool === "colors" ? "bold" : "normal",
          }}
        >
          🎨 Colors
        </button>
        <button
          onClick={() => onToolChange("roots")}
          style={{
            padding: "6px 12px",
            backgroundColor: editingTool === "roots" ? "#e74c3c" : "#bdc3c7",
            color: editingTool === "roots" ? "white" : "#2c3e50",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: editingTool === "roots" ? "bold" : "normal",
          }}
        >
          🌳 Roots
        </button>
        <button
          onClick={() => onToolChange("distance")}
          style={{
            padding: "6px 12px",
            backgroundColor: editingTool === "distance" ? "#9b59b6" : "#bdc3c7",
            color: editingTool === "distance" ? "white" : "#2c3e50",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: editingTool === "distance" ? "bold" : "normal",
          }}
        >
          📏 Distance
        </button>
      </div>

      {editingTool === "colors" && (
        <div style={{ marginTop: "12px" }}>
          <ColorPalette
            selectedColor={selectedColor}
            onColorSelect={onColorSelect}
            numColors={numColors}
          />
        </div>
      )}

      {editingTool === "roots" && (
        <div style={{ marginTop: "12px", fontSize: "12px", color: "#7f8c8d" }}>
          Roots are auto-assigned when you paint a color. Click any colored cell to move its root.
        </div>
      )}

      {editingTool === "distance" && (
        <div style={{ marginTop: "12px", fontSize: "12px", color: "#7f8c8d" }}>
          {pathlengthConstraints.length > 0 && pathlengthConstraints[0].minDistances
            ? `${Object.keys(pathlengthConstraints[0].minDistances).length} distance constraint(s) set`
            : "No distance constraints set. Click a cell to add one."}
        </div>
      )}
    </div>
  );
}
