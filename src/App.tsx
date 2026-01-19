import { useCallback, useState } from "react";
import { ColorPalette, Controls, Grid } from "./components";
import { solveGridColoring } from "./solver";
import type { ColorGrid, GridSolution } from "./solver";
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
    "none" | "found" | "unsatisfiable"
  >("none");
  const numColors = 6;

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      setGrid((prev) => {
        const newColors = prev.colors.map((r) => [...r]);
        newColors[row][col] = selectedColor;
        return { ...prev, colors: newColors };
      });
      setSolution(null);
      setSolutionStatus("none");
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
  }, []);

  const handleSolve = useCallback(() => {
    setSolving(true);
    setSolution(null);

    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      try {
        const result = solveGridColoring(grid, numColors);
        if (result) {
          setSolution(result);
          setSolutionStatus("found");
        } else {
          setSolutionStatus("unsatisfiable");
        }
      } catch (error) {
        console.error("Solver error:", error);
        setSolutionStatus("unsatisfiable");
      }
      setSolving(false);
    }, 10);
  }, [grid, numColors]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
    setSolution(null);
    setSolutionStatus("none");
  }, [gridWidth, gridHeight]);

  const handleFillRandom = useCallback(() => {
    setGrid(createRandomGrid(gridWidth, gridHeight, numColors));
    setSolution(null);
    setSolutionStatus("none");
  }, [gridWidth, gridHeight, numColors]);

  return (
    <div className="app">
      <h1>Grid Coloring Solver</h1>
      <p className="description">
        Paint colors on the grid, then click Solve to find a maze where each
        color forms a single connected region. Walls appear between different
        colors, and within each color the solver ensures all cells are connected.
      </p>

      <div className="main-content">
        <div className="controls-panel">
          <h3>Colors</h3>
          <ColorPalette
            selectedColor={selectedColor}
            onColorSelect={setSelectedColor}
            numColors={numColors}
          />

          <h3>Grid Settings</h3>
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
    </div>
  );
}

export default App;
