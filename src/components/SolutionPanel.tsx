import { useState } from "react";
import { SolutionGrid, KidFriendlyMapView } from "./index";
import type { ColorGrid, GridSolution, ColorRoots } from "../problem";
import type { SolutionMetadata } from "../hooks";

interface SolutionPanelProps {
  solution: GridSolution | null;
  solutionMetadata: SolutionMetadata | null;
  solving: boolean;
  solveTime: number | null;
  satStats: { numVars: number; numClauses: number } | null;
  colorRoots: ColorRoots;
  onCopyToSketchpad: () => void;
  onDownloadSVG: () => void;
  onDownloadCSV: () => void;
}

export function SolutionPanel({
  solution,
  solutionMetadata,
  solving,
  solveTime,
  satStats,
  colorRoots,
  onCopyToSketchpad,
  onDownloadSVG,
  onDownloadCSV,
}: SolutionPanelProps) {
  const [graphMode, setGraphMode] = useState(false);
  const [kidFriendlyMode, setKidFriendlyMode] = useState(false);
  const [selectedLevelConstraintId, setSelectedLevelConstraintId] = useState<string | null>(null);

  const solutionDisplayGrid: ColorGrid | null = solution && solutionMetadata ? {
    width: solutionMetadata.width,
    height: solutionMetadata.height,
    colors: solution.assignedColors,
  } : null;

  return (
    <div style={{ flex: "1", minWidth: "350px" }}>
      <div style={{ 
        padding: "16px", 
        backgroundColor: "#f0fff4", 
        borderRadius: "8px",
        border: "2px solid #27ae60",
      }}>
        <h2 style={{ margin: "0 0 16px 0", color: "#27ae60", fontSize: "1.3em" }}>
          🎯 SAT Solution
        </h2>
        
        {solution && solutionMetadata ? (
          <>
            <p style={{ fontSize: "12px", color: "#7f8c8d", margin: "0 0 12px 0" }}>
              Most recent solver output ({solutionMetadata.width}×{solutionMetadata.height} {solutionMetadata.gridType} grid).
              {solveTime && ` Solved in ${solveTime.toFixed(0)}ms.`}
              {satStats && ` (${satStats.numVars.toLocaleString()} vars, ${satStats.numClauses.toLocaleString()} clauses)`}
            </p>
            
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
              <button
                onClick={onCopyToSketchpad}
                style={{
                  padding: "6px 12px",
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
              <button
                onClick={onDownloadSVG}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#9b59b6",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                Download SVG
              </button>
              <button
                onClick={onDownloadCSV}
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
                Download CSV
              </button>
              {solution.distanceLevels && Object.keys(solution.distanceLevels).length > 0 && !graphMode && (
                <select
                  value={selectedLevelConstraintId ?? ""}
                  onChange={(e) => setSelectedLevelConstraintId(e.target.value || null)}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: selectedLevelConstraintId ? "#27ae60" : "#95a5a6",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  <option value="">Hide Levels</option>
                  {Object.keys(solution.distanceLevels).map((levelKey) => {
                    const colorMatch = levelKey.match(/^color_(\d+)$/);
                    if (colorMatch) {
                      const colorIndex = parseInt(colorMatch[1], 10);
                      const root = colorRoots[String(colorIndex)];
                      const rootInfo = root ? ` (${root.row},${root.col})` : "";
                      const colorNames = ["Red", "Blue", "Green", "Orange", "Purple", "Cyan"];
                      const colorName = colorNames[colorIndex] ?? `Color ${colorIndex}`;
                      return (
                        <option key={levelKey} value={levelKey}>
                          {colorName}{rootInfo}
                        </option>
                      );
                    }
                    return (
                      <option key={levelKey} value={levelKey}>
                        Root {levelKey}
                      </option>
                    );
                  })}
                </select>
              )}
              <button
                onClick={() => {
                  if (graphMode) {
                    setGraphMode(false);
                  } else {
                    setGraphMode(true);
                    setKidFriendlyMode(false);
                  }
                }}
                style={{
                  padding: "6px 12px",
                  backgroundColor: graphMode ? "#3498db" : "#95a5a6",
                  color: "white",
                  border: "none",
                  borderRadius: "4px 0 0 4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                {graphMode ? "Tile View" : "Graph View"}
              </button>
              <button
                onClick={() => {
                  if (kidFriendlyMode) {
                    setKidFriendlyMode(false);
                  } else {
                    setKidFriendlyMode(true);
                    setGraphMode(false);
                  }
                }}
                style={{
                  padding: "6px 12px",
                  backgroundColor: kidFriendlyMode ? "#27ae60" : "#95a5a6",
                  color: "white",
                  border: "none",
                  borderRadius: "0 4px 4px 0",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                {kidFriendlyMode ? "Tile View" : "Kid Map"}
              </button>
            </div>
            
            <div style={{ marginTop: "12px" }}>
              {kidFriendlyMode ? (
                <KidFriendlyMapView
                  grid={solutionDisplayGrid!}
                  solution={solution}
                  cellSize={40}
                  gridType={solutionMetadata.gridType}
                />
              ) : (
                <SolutionGrid
                  grid={solutionDisplayGrid!}
                  solution={solution}
                  cellSize={40}
                  gridType={solutionMetadata.gridType}
                  showDistanceLevels={!!selectedLevelConstraintId && !graphMode}
                  selectedConstraintId={selectedLevelConstraintId}
                  graphMode={graphMode}
                />
              )}
            </div>
          </>
        ) : (
          <div style={{
            padding: "40px", 
            textAlign: "center", 
            color: "#7f8c8d",
            backgroundColor: "#f5f5f5",
            borderRadius: "4px",
          }}>
            <p style={{ margin: 0, fontSize: "14px" }}>
              {solving ? (
                <>
                  ⏳ Solving...
                  {satStats && (
                    <span style={{ display: "block", marginTop: "8px", fontSize: "12px" }}>
                      {satStats.numVars.toLocaleString()} variables, {satStats.numClauses.toLocaleString()} clauses
                    </span>
                  )}
                </>
              ) : "No solution yet. Click Solve to generate one."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
