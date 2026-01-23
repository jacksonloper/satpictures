import React, { useCallback, useState } from "react";
import type { ColorGrid, GridType, PathlengthConstraint } from "../solver";
import { Grid } from "./Grid";

type EditorTool = "root" | "distance";

interface PathlengthConstraintEditorProps {
  /** The grid being edited */
  grid: ColorGrid;
  /** Grid type for rendering */
  gridType: GridType;
  /** The constraint being edited */
  constraint: PathlengthConstraint;
  /** Callback when the constraint is updated */
  onConstraintChange: (constraint: PathlengthConstraint) => void;
  /** Cell size for rendering */
  cellSize?: number;
}

/**
 * PathlengthConstraintEditor is a specialized view for editing a single pathlength constraint.
 * It provides two tools:
 * 1. Root Placer - Click on a cell to set it as the root (origin) for distance calculations
 * 2. Distance Specifier - Click on a cell to assign a minimum distance requirement
 */
export const PathlengthConstraintEditor: React.FC<PathlengthConstraintEditorProps> = ({
  grid,
  gridType,
  constraint,
  onConstraintChange,
  cellSize = 40,
}) => {
  const [selectedTool, setSelectedTool] = useState<EditorTool>("root");
  const [distanceInput, setDistanceInput] = useState<string>("");
  const [pendingCell, setPendingCell] = useState<{ row: number; col: number } | null>(null);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (selectedTool === "root") {
        // Place root at this cell
        onConstraintChange({
          ...constraint,
          root: { row, col },
        });
      } else if (selectedTool === "distance") {
        // Open distance input for this cell
        const cellKey = `${row},${col}`;
        const existingDistance = constraint.minDistances[cellKey];
        setPendingCell({ row, col });
        setDistanceInput(existingDistance ? existingDistance.toString() : "");
      }
    },
    [selectedTool, constraint, onConstraintChange]
  );

  const handleDistanceSubmit = useCallback(() => {
    if (!pendingCell) return;

    const cellKey = `${pendingCell.row},${pendingCell.col}`;
    const parsed = parseInt(distanceInput, 10);

    if (!isNaN(parsed) && parsed > 0) {
      // Valid positive integer - add/update the distance
      onConstraintChange({
        ...constraint,
        minDistances: {
          ...constraint.minDistances,
          [cellKey]: parsed,
        },
      });
    } else if (distanceInput === "" || distanceInput === "0") {
      // Empty or zero - remove the distance constraint
      const newDistances = { ...constraint.minDistances };
      delete newDistances[cellKey];
      onConstraintChange({
        ...constraint,
        minDistances: newDistances,
      });
    }
    // Otherwise (non-numeric input), just close without saving
    
    setPendingCell(null);
    setDistanceInput("");
  }, [pendingCell, distanceInput, constraint, onConstraintChange]);

  const handleDistanceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleDistanceSubmit();
      } else if (e.key === "Escape") {
        setPendingCell(null);
        setDistanceInput("");
      }
    },
    [handleDistanceSubmit]
  );

  // Create a modified grid showing root and distances
  // We'll overlay this information on top of the regular grid
  const renderOverlay = () => {
    const overlays: React.ReactNode[] = [];
    
    // Root marker
    if (constraint.root) {
      const { row, col } = constraint.root;
      overlays.push(
        <div
          key="root"
          style={{
            position: "absolute",
            left: col * cellSize + cellSize / 2,
            top: row * cellSize + cellSize / 2,
            transform: "translate(-50%, -50%)",
            width: cellSize * 0.6,
            height: cellSize * 0.6,
            borderRadius: "50%",
            backgroundColor: "rgba(46, 204, 113, 0.8)",
            border: "3px solid white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold",
            color: "white",
            fontSize: "12px",
            pointerEvents: "none",
          }}
        >
          R
        </div>
      );
    }

    // Distance markers
    for (const [cellKey, distance] of Object.entries(constraint.minDistances)) {
      const [rowStr, colStr] = cellKey.split(",");
      const row = parseInt(rowStr, 10);
      const col = parseInt(colStr, 10);
      
      // Don't show distance marker on root
      if (constraint.root && constraint.root.row === row && constraint.root.col === col) {
        continue;
      }

      overlays.push(
        <div
          key={cellKey}
          style={{
            position: "absolute",
            left: col * cellSize + cellSize / 2,
            top: row * cellSize + cellSize / 2,
            transform: "translate(-50%, -50%)",
            minWidth: cellSize * 0.5,
            height: cellSize * 0.4,
            borderRadius: "4px",
            backgroundColor: "rgba(231, 76, 60, 0.85)",
            border: "2px solid white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: "bold",
            color: "white",
            fontSize: "11px",
            padding: "2px 4px",
            pointerEvents: "none",
          }}
        >
          ≥{distance}
        </div>
      );
    }

    return overlays;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Tool selection */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{ fontWeight: "bold", marginRight: "8px" }}>Tool:</span>
        <button
          onClick={() => setSelectedTool("root")}
          style={{
            padding: "6px 12px",
            backgroundColor: selectedTool === "root" ? "#2ecc71" : "#bdc3c7",
            color: selectedTool === "root" ? "white" : "#2c3e50",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: selectedTool === "root" ? "bold" : "normal",
          }}
        >
          🎯 Root Placer
        </button>
        <button
          onClick={() => setSelectedTool("distance")}
          style={{
            padding: "6px 12px",
            backgroundColor: selectedTool === "distance" ? "#e74c3c" : "#bdc3c7",
            color: selectedTool === "distance" ? "white" : "#2c3e50",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: selectedTool === "distance" ? "bold" : "normal",
          }}
        >
          📏 Distance Specifier
        </button>
      </div>

      {/* Tool description */}
      <p style={{ fontSize: "12px", color: "#7f8c8d", margin: 0 }}>
        {selectedTool === "root"
          ? "Click on a cell to set it as the root (origin) for distance calculations."
          : "Click on a cell to specify a minimum distance from the root."}
      </p>

      {/* Distance input modal */}
      {pendingCell && (
        <div
          style={{
            padding: "12px",
            backgroundColor: "#fff3cd",
            borderRadius: "4px",
            border: "1px solid #ffc107",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>
            Minimum distance for cell ({pendingCell.row}, {pendingCell.col}):
          </span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={distanceInput}
            onChange={(e) => setDistanceInput(e.target.value)}
            onKeyDown={handleDistanceKeyDown}
            onBlur={handleDistanceSubmit}
            autoFocus
            style={{
              width: "60px",
              padding: "4px 8px",
              borderRadius: "4px",
              border: "1px solid #bdc3c7",
              fontSize: "14px",
            }}
            placeholder="e.g. 5"
          />
          <span style={{ fontSize: "12px", color: "#7f8c8d" }}>
            (Enter positive integer, empty/0 to remove)
          </span>
        </div>
      )}

      {/* Grid with overlay */}
      <div style={{ position: "relative" }}>
        <Grid
          grid={grid}
          solution={null}
          selectedColor={null}
          onCellClick={handleCellClick}
          onCellDrag={() => {}}
          cellSize={cellSize}
          gridType={gridType}
          viewMode="sketchpad"
        />
        {/* Overlay for root and distance markers */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
          }}
        >
          {renderOverlay()}
        </div>
      </div>

      {/* Summary */}
      <div style={{ fontSize: "12px", color: "#7f8c8d" }}>
        <strong>Constraint Summary:</strong>{" "}
        {constraint.root
          ? `Root at (${constraint.root.row}, ${constraint.root.col})`
          : "No root set"}{" "}
        | {Object.keys(constraint.minDistances).length} distance requirement(s)
      </div>
    </div>
  );
};
