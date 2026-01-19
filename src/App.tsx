import { useCallback, useEffect, useRef, useState } from "react";
import { ColorPalette, Controls, Grid } from "./components";
import type { ColorGrid, GridSolution, SolverRequest, SolverResponse } from "./solver";
import SolverWorker from "./solver/solver.worker?worker";
import "./App.css";

function createEmptyGrid(width: number, height: number): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => null)
    ),
  };
}

function createRandomGrid(
  width: number,
  height: number,
  numColors: number
): ColorGrid {
  return {
    width,
    height,
    colors: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => Math.floor(Math.random() * numColors))
    ),
  };
}

function App() {
  const [gridWidth, setGridWidth] = useState(6);
  const [gridHeight, setGridHeight] = useState(6);
  const [grid, setGrid] = useState<ColorGrid>(() =>
    createEmptyGrid(gridWidth, gridHeight)
  );
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [solution, setSolution] = useState<GridSolution | null>(null);
  const [solving, setSolving] = useState(false);
  const [solutionStatus, setSolutionStatus] = useState<
    "none" | "found" | "unsatisfiable" | "error"
  >("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const numColors = 6;

  // Web Worker for non-blocking solving
  const workerRef = useRef<Worker | null>(null);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolution(null);
      setSolutionStatus("none");
      setErrorMessage(null);
    },
    [selectedColor]
  );

  const handleCellDrag = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolution(null);
      setSolutionStatus("none");
      setErrorMessage(null);
    },
    [selectedColor]
  );

  const handleWidthChange = useCallback((width: number) => {
    const clampedWidth = Math.min(Math.max(width, 2), 20);
    setGridWidth(clampedWidth);
    setGrid((prev) => {
      const newColors = Array.from({ length: prev.height }, (_, row) =>
        Array.from({ length: clampedWidth }, (_, col) =>
          col < prev.width ? prev.colors[row][col] : null
        )
      );
      return { width: clampedWidth, height: prev.height, colors: newColors };
    });
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
  }, []);

  const handleHeightChange = useCallback((height: number) => {
    const clampedHeight = Math.min(Math.max(height, 2), 20);
    setGridHeight(clampedHeight);
    setGrid((prev) => {
      const newColors = Array.from({ length: clampedHeight }, (_, row) =>
        Array.from({ length: prev.width }, (_, col) =>
          row < prev.height ? prev.colors[row][col] : null
        )
      );
      return { width: prev.width, height: clampedHeight, colors: newColors };
    });
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
  }, []);

  const handleSolve = useCallback(() => {
    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setSolving(true);
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);

    // Create a new worker for this solve
    const worker = new SolverWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      const { success, solution, error } = event.data;
      if (success && solution) {
        setSolution(solution);
        setSolutionStatus("found");
        setErrorMessage(null);
      } else if (success && !solution) {
        // SAT solver returned null (unsatisfiable)
        setSolutionStatus("unsatisfiable");
        setErrorMessage(null);
      } else {
        // Error occurred (e.g., out of memory)
        setSolutionStatus("error");
        setErrorMessage(error || "Unknown error");
        console.error("Solver error:", error);
      }
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = (error) => {
      console.error("Worker error:", error);
      setSolutionStatus("error");
      setErrorMessage("Worker crashed - the grid may be too large to solve");
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    // Send the solve request
    const request: SolverRequest = { grid, numColors };
    worker.postMessage(request);
  }, [grid, numColors]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
  }, [gridWidth, gridHeight]);

  const handleFillRandom = useCallback(() => {
    setGrid(createRandomGrid(gridWidth, gridHeight, numColors));
    setSolution(null);
    setSolutionStatus("none");
    setErrorMessage(null);
  }, [gridWidth, gridHeight, numColors]);

  return (
    <div className="app">
      <h1>Grid Coloring Solver</h1>
      <p className="description">
        Set your grid size below, then paint some cells with colors (or leave them blank
        for the solver to decide). Click Solve to find a valid coloring where each
        color forms a single connected region.
      </p>

      <div className="controls-panel">
        <h3>Grid Size</h3>
        <Controls
          gridWidth={gridWidth}
          gridHeight={gridHeight}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
          onSolve={handleSolve}
          onClear={handleClear}
          onFillRandom={handleFillRandom}
          solving={solving}
          solutionStatus={solutionStatus}
          errorMessage={errorMessage}
        />

        <h3>Colors</h3>
        <ColorPalette
          selectedColor={selectedColor}
          onColorSelect={setSelectedColor}
          numColors={numColors}
        />
      </div>

      <div className="grid-panel">
        <Grid
          grid={grid}
          solution={solution}
          selectedColor={selectedColor}
          onCellClick={handleCellClick}
          onCellDrag={handleCellDrag}
          cellSize={40}
        />
      </div>
    </div>
  );
}

export default App;
