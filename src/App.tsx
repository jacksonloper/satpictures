import { useCallback, useState } from "react";
import { Controls, SketchpadGrid, ToolPanel, DistanceInputDialog, SolutionPanel, downloadSolutionSVG } from "./components";
import type { EditingTool } from "./components";
import { HATCH_COLOR } from "./problem";
import { useGridState } from "./hooks";
import "./App.css";

const NUM_COLORS = 6;

function App() {
  const [state, actions] = useGridState();
  const {
    gridWidth,
    gridHeight,
    grid,
    selectedColor,
    solution,
    solutionMetadata,
    solving,
    solutionStatus,
    errorMessage,
    solverType,
    solveTime,
    gridType,
    pathlengthConstraints,
    selectedConstraintId,
    colorRoots,
    satStats,
  } = state;

  const [editingTool, setEditingTool] = useState<EditingTool>("colors");
  const [distanceInput, setDistanceInput] = useState<string>("");
  const [pendingDistanceCell, setPendingDistanceCell] = useState<{ row: number; col: number } | null>(null);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (editingTool === "colors") {
        actions.updateGridCell(row, col, selectedColor);
      } else if (editingTool === "roots") {
        const cellColor = actions.getGridColorAt(row, col);
        if (cellColor !== null && cellColor !== HATCH_COLOR && cellColor >= 0) {
          actions.setColorRoot(cellColor, row, col);
        }
      } else if (editingTool === "distance") {
        const cellKey = `${row},${col}`;
        const constraint = pathlengthConstraints[0];
        const existingDistance = constraint?.minDistances[cellKey];
        setPendingDistanceCell({ row, col });
        setDistanceInput(existingDistance ? existingDistance.toString() : "");
      }
    },
    [editingTool, selectedColor, pathlengthConstraints, actions]
  );

  const handleCellDrag = useCallback(
    (row: number, col: number) => {
      if (editingTool === "colors") {
        actions.updateGridCell(row, col, selectedColor);
      }
    },
    [editingTool, selectedColor, actions]
  );

  const handleDistanceSubmit = useCallback(() => {
    if (!pendingDistanceCell) return;

    const cellKey = `${pendingDistanceCell.row},${pendingDistanceCell.col}`;
    const parsed = parseInt(distanceInput, 10);

    if (!isNaN(parsed) && parsed > 0) {
      actions.updateDistanceConstraint(cellKey, parsed);
    } else if (distanceInput === "" || distanceInput === "0") {
      actions.updateDistanceConstraint(cellKey, null);
    }
    
    setPendingDistanceCell(null);
    setDistanceInput("");
  }, [pendingDistanceCell, distanceInput, actions]);

  const handleDistanceKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleDistanceSubmit();
      } else if (e.key === "Escape") {
        setPendingDistanceCell(null);
        setDistanceInput("");
      }
    },
    [handleDistanceSubmit]
  );

  const handleDownloadSVG = useCallback(() => {
    actions.handleDownloadSVG(downloadSolutionSVG);
  }, [actions]);

  return (
    <div className="app">
      <h1>Grid Coloring Solver</h1>
      <p className="description">
        Set your grid size below, then paint some cells with colors (or leave them blank
        for the solver to decide). Click Solve to find a valid coloring where each
        color forms a tree rooted at a designated cell.
      </p>
      <p className="description" style={{ fontSize: "0.9em", fontStyle: "italic", marginTop: "-8px" }}>
        <strong>Purpose:</strong> While purpose-built maze software can solve these problems more efficiently,
        this project explores how far modern SAT solvers have come by encoding the problem as pure logical constraints.
      </p>

      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap", alignItems: "flex-start" }}>
        
        {/* Sketchpad Section */}
        <div style={{ flex: "1", minWidth: "350px" }}>
          <div style={{ 
            padding: "16px", 
            backgroundColor: "#f8f9fa", 
            borderRadius: "8px",
            border: "2px solid #3498db",
          }}>
            <h2 style={{ margin: "0 0 16px 0", color: "#2c3e50", fontSize: "1.3em" }}>
              📝 Sketchpad
            </h2>
            
            <Controls
              gridWidth={gridWidth}
              gridHeight={gridHeight}
              onWidthChange={actions.handleWidthChange}
              onHeightChange={actions.handleHeightChange}
              onSolve={actions.handleSolve}
              onClear={actions.handleClear}
              onMazeSetup={actions.handleMazeSetup}
              onCancel={actions.handleCancel}
              solving={solving}
              solutionStatus={solutionStatus}
              errorMessage={errorMessage}
              solverType={solverType}
              onSolverTypeChange={actions.setSolverType}
              solveTime={solveTime}
              solution={solution}
              gridType={gridType}
              onGridTypeChange={actions.handleGridTypeChange}
              onDownloadColors={actions.handleDownloadSketchpadColors}
              onUploadColors={actions.handleUploadColors}
              grid={grid}
              pathlengthConstraints={pathlengthConstraints}
              onPathlengthConstraintsChange={actions.setPathlengthConstraints}
              selectedConstraintId={selectedConstraintId}
              onSelectedConstraintIdChange={actions.setSelectedConstraintId}
            />

            <div style={{ marginTop: "16px" }}>
              <SketchpadGrid
                grid={grid}
                solution={null}
                selectedColor={editingTool === "colors" ? selectedColor : null}
                onCellClick={handleCellClick}
                onCellDrag={handleCellDrag}
                cellSize={40}
                gridType={gridType}
                colorRoots={colorRoots}
                distanceConstraint={pathlengthConstraints[0]}
              />
            </div>

            {pendingDistanceCell && (
              <DistanceInputDialog
                pendingCell={pendingDistanceCell}
                distanceInput={distanceInput}
                onDistanceInputChange={setDistanceInput}
                onSubmit={handleDistanceSubmit}
                onCancel={() => {
                  setPendingDistanceCell(null);
                  setDistanceInput("");
                }}
                onKeyDown={handleDistanceKeyDown}
              />
            )}

            <ToolPanel
              editingTool={editingTool}
              onToolChange={setEditingTool}
              selectedColor={selectedColor}
              onColorSelect={actions.setSelectedColor}
              numColors={NUM_COLORS}
              pathlengthConstraints={pathlengthConstraints}
            />
          </div>
        </div>

        {/* Solution Section */}
        <SolutionPanel
          solution={solution}
          solutionMetadata={solutionMetadata}
          solving={solving}
          solveTime={solveTime}
          satStats={satStats}
          colorRoots={colorRoots}
          onCopyToSketchpad={actions.handleCopyToSketchpad}
          onDownloadSVG={handleDownloadSVG}
          onDownloadCSV={actions.handleDownloadSolutionColors}
        />
      </div>
    </div>
  );
}

export default App;
