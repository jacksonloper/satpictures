import { useCallback, useEffect, useRef, useState } from "react";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint, SolverRequest, SolverResponse, SolverType, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import SolverWorker from "../problem/solver.worker?worker";
import CadicalWorker from "../problem/cadical.worker?worker";
import DPLLWorker from "../problem/dpll.worker?worker";
import { createEmptyGrid, createMazeSetupGrid, generateConstraintId } from "../gridHelpers";

export interface SolutionMetadata {
  gridType: GridType;
  width: number;
  height: number;
}

export interface GridState {
  gridWidth: number;
  gridHeight: number;
  grid: ColorGrid;
  selectedColor: number | null;
  solution: GridSolution | null;
  solutionMetadata: SolutionMetadata | null;
  solving: boolean;
  solutionStatus: "none" | "found" | "unsatisfiable" | "error";
  errorMessage: string | null;
  solverType: SolverType;
  solveTime: number | null;
  gridType: GridType;
  pathlengthConstraints: PathlengthConstraint[];
  selectedConstraintId: string | null;
  colorRoots: ColorRoots;
  satStats: { numVars: number; numClauses: number } | null;
}

export interface GridActions {
  setSelectedColor: (color: number | null) => void;
  setSolverType: (type: SolverType) => void;
  handleWidthChange: (width: number) => void;
  handleHeightChange: (height: number) => void;
  handleSolve: () => void;
  handleClear: () => void;
  handleMazeSetup: () => void;
  handleCancel: () => void;
  handleGridTypeChange: (type: GridType) => void;
  handleCopyToSketchpad: () => void;
  handleDownloadSketchpadColors: () => void;
  handleDownloadSolutionColors: () => void;
  handleDownloadSVG: (downloadFn: (solution: GridSolution, width: number, height: number, gridType: GridType) => void) => void;
  handleUploadColors: (file: File) => void;
  setPathlengthConstraints: React.Dispatch<React.SetStateAction<PathlengthConstraint[]>>;
  setSelectedConstraintId: (id: string | null) => void;
  updateGridCell: (row: number, col: number, color: number | null) => void;
  setColorRoot: (color: number, row: number, col: number) => void;
  updateDistanceConstraint: (cellKey: string, distance: number | null) => void;
  setSolutionStatus: (status: "none" | "found" | "unsatisfiable" | "error") => void;
  getGridColorAt: (row: number, col: number) => number | null;
}

export function useGridState(): [GridState, GridActions] {
  const [gridWidth, setGridWidth] = useState(6);
  const [gridHeight, setGridHeight] = useState(6);
  const [grid, setGrid] = useState<ColorGrid>(() =>
    createEmptyGrid(gridWidth, gridHeight)
  );
  const [selectedColor, setSelectedColor] = useState<number | null>(null);
  const [solution, setSolution] = useState<GridSolution | null>(null);
  const [solutionMetadata, setSolutionMetadata] = useState<SolutionMetadata | null>(null);
  const [solving, setSolving] = useState(false);
  const [solutionStatus, setSolutionStatus] = useState<
    "none" | "found" | "unsatisfiable" | "error"
  >("none");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [solverType, setSolverType] = useState<SolverType>("cadical");
  const [solveTime, setSolveTime] = useState<number | null>(null);
  const [gridType, setGridType] = useState<GridType>("square");
  const [pathlengthConstraints, setPathlengthConstraints] = useState<PathlengthConstraint[]>([]);
  const [selectedConstraintId, setSelectedConstraintId] = useState<string | null>(null);
  const [colorRoots, setColorRoots] = useState<ColorRoots>({});
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const updateRootsForGrid = useCallback((gridColors: (number | null)[][], gridWidth: number, gridHeight: number, currentRoots: ColorRoots): ColorRoots => {
    const usedColors = new Set<number>();
    for (const row of gridColors) {
      for (const cell of row) {
        if (cell !== null && cell !== HATCH_COLOR && cell >= 0) {
          usedColors.add(cell);
        }
      }
    }

    const newRoots = { ...currentRoots };
    let changed = false;

    for (const colorStr of Object.keys(newRoots)) {
      const color = parseInt(colorStr, 10);
      if (!usedColors.has(color)) {
        delete newRoots[colorStr];
        changed = true;
      }
    }

    for (const colorStr of Object.keys(newRoots)) {
      const color = parseInt(colorStr, 10);
      const root = newRoots[colorStr];
      if (root && gridColors[root.row]?.[root.col] !== color) {
        let foundNew = false;
        for (let r = 0; r < gridHeight && !foundNew; r++) {
          for (let c = 0; c < gridWidth && !foundNew; c++) {
            if (gridColors[r][c] === color) {
              newRoots[colorStr] = { row: r, col: c };
              foundNew = true;
              changed = true;
            }
          }
        }
        if (!foundNew) {
          delete newRoots[colorStr];
          changed = true;
        }
      }
    }

    for (const color of usedColors) {
      if (!newRoots[String(color)]) {
        for (let r = 0; r < gridHeight; r++) {
          for (let c = 0; c < gridWidth; c++) {
            if (gridColors[r][c] === color) {
              newRoots[String(color)] = { row: r, col: c };
              changed = true;
              break;
            }
          }
          if (newRoots[String(color)]) break;
        }
      }
    }

    return changed ? newRoots : currentRoots;
  }, []);

  const handleWidthChange = useCallback((width: number) => {
    const clampedWidth = Math.min(Math.max(width, 2), 20);
    setGridWidth(clampedWidth);
    setGrid((prev) => {
      const newColors = Array.from({ length: prev.height }, (_, row) =>
        Array.from({ length: clampedWidth }, (_, col) =>
          col < prev.width ? prev.colors[row][col] : null
        )
      );
      const newGrid = { width: clampedWidth, height: prev.height, colors: newColors };
      setColorRoots((prevRoots) => updateRootsForGrid(newGrid.colors, newGrid.width, newGrid.height, prevRoots));
      return newGrid;
    });
  }, [updateRootsForGrid]);

  const handleHeightChange = useCallback((height: number) => {
    const clampedHeight = Math.min(Math.max(height, 2), 20);
    setGridHeight(clampedHeight);
    setGrid((prev) => {
      const newColors = Array.from({ length: clampedHeight }, (_, row) =>
        Array.from({ length: prev.width }, (_, col) =>
          row < prev.height ? prev.colors[row][col] : null
        )
      );
      const newGrid = { width: prev.width, height: clampedHeight, colors: newColors };
      setColorRoots((prevRoots) => updateRootsForGrid(newGrid.colors, newGrid.width, newGrid.height, prevRoots));
      return newGrid;
    });
  }, [updateRootsForGrid]);

  const handleSolve = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setSolving(true);
    setSolution(null);
    setSolutionMetadata(null);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
    setSatStats(null);

    const startTime = performance.now();
    const currentGridType = gridType;
    const currentWidth = grid.width;
    const currentHeight = grid.height;

    let worker: Worker;
    if (solverType === "cadical") {
      worker = new CadicalWorker();
    } else if (solverType === "dpll") {
      worker = new DPLLWorker();
    } else {
      worker = new SolverWorker();
    }
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      const { success, solution, error, messageType, stats } = event.data;
      
      if (messageType === "progress" && stats) {
        setSatStats(stats);
        return;
      }
      
      const endTime = performance.now();
      setSolveTime(endTime - startTime);
      
      if (solution?.stats) {
        setSatStats(solution.stats);
      }
      
      if (success && solution) {
        setSolution(solution);
        setSolutionMetadata({
          gridType: currentGridType,
          width: currentWidth,
          height: currentHeight,
        });
        setSolutionStatus("found");
        setErrorMessage(null);
      } else if (success && !solution) {
        setSolutionStatus("unsatisfiable");
        setErrorMessage(null);
      } else {
        setSolutionStatus("error");
        setErrorMessage(error || "An unexpected error occurred while solving the grid.");
        console.error("Solver error:", error);
      }
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.onerror = (error) => {
      const endTime = performance.now();
      setSolveTime(endTime - startTime);
      console.error("Worker error:", error);
      setSolutionStatus("error");
      setErrorMessage("Worker crashed - the grid may be too large to solve");
      setSolving(false);
      worker.terminate();
      workerRef.current = null;
    };

    const request: SolverRequest = { 
      gridType, 
      width: grid.width, 
      height: grid.height, 
      colors: grid.colors, 
      pathlengthConstraints,
      colorRoots,
    };
    worker.postMessage(request);
  }, [grid, solverType, gridType, pathlengthConstraints, colorRoots]);

  const handleClear = useCallback(() => {
    setGrid(createEmptyGrid(gridWidth, gridHeight));
    setColorRoots({});
    setPathlengthConstraints([]);
    setSelectedConstraintId(null);
    setSolutionStatus("none");
  }, [gridWidth, gridHeight]);

  const handleMazeSetup = useCallback(() => {
    const { grid, constraint } = createMazeSetupGrid(gridWidth, gridHeight);
    setGrid(grid);
    setPathlengthConstraints([constraint]);
    setSelectedConstraintId(constraint.id);
    const middleRow = Math.floor(gridHeight / 2);
    setColorRoots({ "0": { row: middleRow, col: 0 } });
  }, [gridWidth, gridHeight]);

  const handleCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setSolving(false);
    setSolutionStatus("none");
    setErrorMessage(null);
    setSolveTime(null);
  }, []);

  const handleGridTypeChange = useCallback((newGridType: GridType) => {
    setGridType(newGridType);
  }, []);

  const handleCopyToSketchpad = useCallback(() => {
    if (!solution || !solutionMetadata) return;
    
    setGridWidth(solutionMetadata.width);
    setGridHeight(solutionMetadata.height);
    setGridType(solutionMetadata.gridType);
    const newGrid = {
      width: solutionMetadata.width,
      height: solutionMetadata.height,
      colors: solution.assignedColors.map(row => [...row]),
    };
    setGrid(newGrid);
    setColorRoots((prevRoots) => updateRootsForGrid(newGrid.colors, newGrid.width, newGrid.height, prevRoots));
  }, [solution, solutionMetadata, updateRootsForGrid]);

  const handleDownloadSketchpadColors = useCallback(() => {
    const csvContent = grid.colors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchpad-colors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [grid]);

  const handleDownloadSolutionColors = useCallback(() => {
    if (!solution) return;
    
    const csvContent = solution.assignedColors
      .map(row => row.map(c => c === null ? -1 : c).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "solution-colors.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [solution]);

  const handleDownloadSVG = useCallback((downloadFn: (solution: GridSolution, width: number, height: number, gridType: GridType) => void) => {
    if (!solution || !solutionMetadata) return;
    downloadFn(solution, solutionMetadata.width, solutionMetadata.height, solutionMetadata.gridType);
  }, [solution, solutionMetadata]);

  const handleUploadColors = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content || !content.trim()) return;
      
      const lines = content.trim().split("\n");
      if (lines.length === 0) return;
      
      const parsedColors: (number | null)[][] = lines.map(line => 
        line.split(",").map(val => {
          const num = parseInt(val.trim(), 10);
          if (isNaN(num) || num === -1) return null;
          return num >= 0 ? num : null;
        })
      );
      
      const newHeight = parsedColors.length;
      const newWidth = parsedColors[0]?.length || gridWidth;
      
      const clampedWidth = Math.min(Math.max(newWidth, 2), 20);
      const clampedHeight = Math.min(Math.max(newHeight, 2), 20);
      
      const adjustedColors = Array.from({ length: clampedHeight }, (_, row) =>
        Array.from({ length: clampedWidth }, (_, col) =>
          row < parsedColors.length && col < (parsedColors[row]?.length || 0)
            ? parsedColors[row][col]
            : null
        )
      );
      
      const newGrid = {
        width: clampedWidth,
        height: clampedHeight,
        colors: adjustedColors,
      };
      setGridWidth(clampedWidth);
      setGridHeight(clampedHeight);
      setGrid(newGrid);
      setColorRoots((prevRoots) => updateRootsForGrid(newGrid.colors, newGrid.width, newGrid.height, prevRoots));
    };
    reader.readAsText(file);
  }, [gridWidth, updateRootsForGrid]);

  const updateGridCell = useCallback((row: number, col: number, color: number | null) => {
    setGrid((prev) => {
      const newColors = prev.colors.map((r) => [...r]);
      newColors[row][col] = color;
      const newGrid = { ...prev, colors: newColors };
      setColorRoots((prevRoots) => updateRootsForGrid(newGrid.colors, newGrid.width, newGrid.height, prevRoots));
      return newGrid;
    });
    setSolutionStatus("none");
  }, [updateRootsForGrid]);

  const setColorRoot = useCallback((color: number, row: number, col: number) => {
    setColorRoots((prev) => ({
      ...prev,
      [String(color)]: { row, col },
    }));
    setSolutionStatus("none");
  }, []);

  const updateDistanceConstraint = useCallback((cellKey: string, distance: number | null) => {
    setPathlengthConstraints((prev) => {
      let constraint = prev[0];
      if (!constraint) {
        constraint = {
          id: generateConstraintId(),
          minDistances: {},
        };
      }

      if (distance !== null && distance > 0) {
        const updatedConstraint = {
          ...constraint,
          minDistances: {
            ...constraint.minDistances,
            [cellKey]: distance,
          },
        };
        setSelectedConstraintId(updatedConstraint.id);
        return [updatedConstraint];
      } else {
        const newDistances = { ...constraint.minDistances };
        delete newDistances[cellKey];
        if (Object.keys(newDistances).length > 0) {
          return [{ ...constraint, minDistances: newDistances }];
        } else {
          setSelectedConstraintId(null);
          return [];
        }
      }
    });
    setSolutionStatus("none");
  }, []);

  const getGridColorAt = useCallback((row: number, col: number) => {
    return grid.colors[row]?.[col] ?? null;
  }, [grid.colors]);

  const state: GridState = {
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
  };

  const actions: GridActions = {
    setSelectedColor,
    setSolverType,
    handleWidthChange,
    handleHeightChange,
    handleSolve,
    handleClear,
    handleMazeSetup,
    handleCancel,
    handleGridTypeChange,
    handleCopyToSketchpad,
    handleDownloadSketchpadColors,
    handleDownloadSolutionColors,
    handleDownloadSVG,
    handleUploadColors,
    setPathlengthConstraints,
    setSelectedConstraintId,
    updateGridCell,
    setColorRoot,
    updateDistanceConstraint,
    setSolutionStatus,
    getGridColorAt,
  };

  return [state, actions];
}
