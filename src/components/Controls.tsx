import React, { useCallback } from "react";
import type { GridType, PathlengthConstraint, GridSolution } from "../problem";

interface ControlsProps {
  gridWidth: number;
  gridHeight: number;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onSolve: () => void;
  onClear: () => void;
  onMazeSetup: () => void;
  onCancel?: () => void;
  solving: boolean;
  solutionStatus: "none" | "found" | "unsatisfiable" | "error";
  errorMessage?: string | null;
  solverType?: "minisat" | "cadical" | "dpll";
  onSolverTypeChange?: (solverType: "minisat" | "cadical" | "dpll") => void;
  solveTime?: number | null;
  solution?: GridSolution | null;
  gridType?: GridType;
  onGridTypeChange?: (gridType: GridType) => void;
  onDownloadColors?: () => void;
  onUploadColors?: (file: File) => void;
  grid?: { colors: (number | null)[][] };
  pathlengthConstraints?: PathlengthConstraint[];
  onPathlengthConstraintsChange?: (constraints: PathlengthConstraint[]) => void;
  selectedConstraintId?: string | null;
  onSelectedConstraintIdChange?: (id: string | null) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  gridWidth,
  gridHeight,
  onWidthChange,
  onHeightChange,
  onSolve,
  onClear,
  onMazeSetup,
  onCancel,
  solving,
  solutionStatus,
  errorMessage,
  solverType = "cadical",
  onSolverTypeChange,
  solveTime,
  solution: _solution,
  gridType = "square",
  onGridTypeChange,
  onDownloadColors,
  onUploadColors,
  grid,
  // Unused props (will be used later for pathlength constraints UI)
  pathlengthConstraints: _pathlengthConstraints,
  onPathlengthConstraintsChange: _onPathlengthConstraintsChange,
  selectedConstraintId: _selectedConstraintId,
  onSelectedConstraintIdChange: _onSelectedConstraintIdChange,
}) => {
  // Note: Pathlength constraint props are passed through but not used in Controls.
  // The pathlength constraint management UI is in App.tsx using PathlengthConstraintEditor.
  // These props are kept for API consistency.
  void _solution;
  void _pathlengthConstraints;
  void _onPathlengthConstraintsChange;
  void _selectedConstraintId;
  void _onSelectedConstraintIdChange;
  
  // File input ref for upload
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadColors) {
      onUploadColors(file);
    }
    // Reset input so same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onUploadColors]);

  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ minWidth: "50px" }}>Width:</span>
          <input
            type="range"
            min="2"
            max="20"
            value={gridWidth}
            onChange={(e) => onWidthChange(parseInt(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <span style={{ minWidth: "24px", textAlign: "right" }}>{gridWidth}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ minWidth: "50px" }}>Height:</span>
          <input
            type="range"
            min="2"
            max="20"
            value={gridHeight}
            onChange={(e) => onHeightChange(parseInt(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <span style={{ minWidth: "24px", textAlign: "right" }}>{gridHeight}</span>
        </label>
        {onSolverTypeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Solver:</span>
            <select
              value={solverType}
              onChange={(e) => onSolverTypeChange(e.target.value as "minisat" | "cadical" | "dpll")}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <option value="cadical">CaDiCaL (2019)</option>
              <option value="minisat">MiniSat (2005)</option>
              <option value="dpll">DPLL (1962)</option>
            </select>
          </label>
        )}
        {onGridTypeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Grid:</span>
            <select
              value={gridType}
              onChange={(e) => onGridTypeChange(e.target.value as GridType)}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <option value="square">Square</option>
              <option value="hex">Hex</option>
              <option value="octagon">Octagon</option>
              <option value="cairo">Cairo</option>
              <option value="cairobridge">Cairo Bridge</option>
            </select>
          </label>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={onSolve}
          disabled={solving}
          style={{
            padding: "8px 16px",
            backgroundColor: "#2ecc71",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: solving ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {solving ? "Solving..." : "Solve"}
        </button>
        {solving && onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              backgroundColor: "#e67e22",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={onClear}
          style={{
            padding: "8px 16px",
            backgroundColor: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <button
          onClick={onMazeSetup}
          style={{
            padding: "8px 16px",
            backgroundColor: "#3498db",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Maze Setup
        </button>
      </div>

      {/* Color CSV Download/Upload */}
      <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {onDownloadColors && grid && (
          <button
            onClick={onDownloadColors}
            style={{
              padding: "6px 12px",
              backgroundColor: "#8e44ad",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Download Colors (CSV)
          </button>
        )}
        {onUploadColors && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: "6px 12px",
                backgroundColor: "#2980b9",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Upload Colors (CSV)
            </button>
          </>
        )}
      </div>

      {solutionStatus !== "none" && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            borderRadius: "4px",
            backgroundColor:
              solutionStatus === "found"
                ? "#d5f5e3"
                : solutionStatus === "error"
                  ? "#fdebd0"
                  : "#fadbd8",
            color:
              solutionStatus === "found"
                ? "#1e8449"
                : solutionStatus === "error"
                  ? "#9c640c"
                  : "#922b21",
          }}
        >
          {solutionStatus === "found"
            ? `Solution found! Each color region is now connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : solverType === "dpll" ? "DPLL" : "MiniSat"})` : ""}${_solution ? ` Walls: ${Math.round(_solution.wallEdges.length / (_solution.wallEdges.length + _solution.keptEdges.length) * 100)}%` : ""}`
            : solutionStatus === "error"
              ? errorMessage || "Unknown error occurred."
              : `No solution exists - some color regions cannot be connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : solverType === "dpll" ? "DPLL" : "MiniSat"})` : ""}`}
        </div>
      )}
    </div>
  );
};
