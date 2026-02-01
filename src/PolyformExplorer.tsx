import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import "./App.css";
import type { TilingResult } from "./problem/polyomino-tiling";
import type { HexTilingResult } from "./problem/polyhex-tiling";
import type { TriTilingResult } from "./problem/polyiamond-tiling";
import {
  type PolyformType,
  createEmptyBooleanGrid,
  rotatePolyomino,
  rotatePolyhex,
  rotatePolyiamond,
  transformPolyhex,
  transformPolyiamond,
  flipHorizontal,
  flipVertical,
} from "./utils/polyformTransforms";
import { type EdgeKey, makeEdgeKey, parseEdgeKey } from "./utils/edgeKey";
import {
  SquareGrid,
  HexGrid,
  TriangleGrid,
  TilingViewer,
  HexTilingViewer,
  TriTilingViewer,
  downloadSvg,
  exportCellsToJson,
  parseCoordsJson,
  downloadJson,
  PolyformControls,
  generateMaze,
  MazeViewer,
  type MazeResult,
  generateHexMaze,
  HexMazeViewer,
  type HexMazeResult,
  generateTriMaze,
  TriMazeViewer,
  type TriMazeResult,
} from "./polyform-explorer";

/**
 * Polyform Explorer Component
 * Allows users to build polyomino, polyhex, or polyiamond shapes
 * with rotation and flip controls.
 */

/** Represents a single tile with its grid and dimensions */
interface TileState {
  cells: boolean[][];
  /** Set of edge keys that have roads (edges between filled cells) */
  roads: Set<EdgeKey>;
  gridWidth: number;
  gridHeight: number;
  widthInput: string;
  heightInput: string;
  widthError: boolean;
  heightError: boolean;
}

/** Create a new empty tile state */
function createEmptyTileState(width: number = 8, height: number = 8): TileState {
  return {
    cells: createEmptyBooleanGrid(width, height),
    roads: new Set<EdgeKey>(),
    gridWidth: width,
    gridHeight: height,
    widthInput: String(width),
    heightInput: String(height),
    widthError: false,
    heightError: false,
  };
}

export function PolyformExplorer() {
  const [polyformType, setPolyformType] = useState<PolyformType>("polyomino");
  
  // Multi-tile state: array of tiles and the currently active tile index
  const [tiles, setTiles] = useState<TileState[]>(() => [createEmptyTileState(8, 8)]);
  const [activeTileIndex, setActiveTileIndex] = useState(0);
  
  // Derived state for the active tile (for convenience)
  // Use a safe fallback in case activeTileIndex is temporarily out of bounds during state transitions
  const activeTile = tiles[activeTileIndex] ?? tiles[0] ?? createEmptyTileState(8, 8);
  const gridWidth = activeTile.gridWidth;
  const gridHeight = activeTile.gridHeight;
  const cells = activeTile.cells;
  const roads = activeTile.roads;
  const widthInput = activeTile.widthInput;
  const heightInput = activeTile.heightInput;
  const widthError = activeTile.widthError;
  const heightError = activeTile.heightError;
  
  // Setter helpers that update the active tile
  const updateActiveTile = useCallback((updates: Partial<TileState>) => {
    setTiles(prev => prev.map((tile, i) => 
      i === activeTileIndex ? { ...tile, ...updates } : tile
    ));
  }, [activeTileIndex]);
  
  const setCells = useCallback((updater: boolean[][] | ((prev: boolean[][]) => boolean[][])) => {
    setTiles(prev => prev.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      const newCells = typeof updater === 'function' ? updater(tile.cells) : updater;
      return { ...tile, cells: newCells };
    }));
  }, [activeTileIndex]);
  
  const setRoads = useCallback((updater: Set<EdgeKey> | ((prev: Set<EdgeKey>) => Set<EdgeKey>)) => {
    setTiles(prev => prev.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      const newRoads = typeof updater === 'function' ? updater(tile.roads) : updater;
      return { ...tile, roads: newRoads };
    }));
  }, [activeTileIndex]);
  
  const setGridWidth = useCallback((width: number) => {
    updateActiveTile({ gridWidth: width });
  }, [updateActiveTile]);
  
  const setGridHeight = useCallback((height: number) => {
    updateActiveTile({ gridHeight: height });
  }, [updateActiveTile]);
  
  const setWidthInput = useCallback((value: string) => {
    updateActiveTile({ widthInput: value });
  }, [updateActiveTile]);
  
  const setHeightInput = useCallback((value: string) => {
    updateActiveTile({ heightInput: value });
  }, [updateActiveTile]);
  
  const setWidthError = useCallback((value: boolean) => {
    updateActiveTile({ widthError: value });
  }, [updateActiveTile]);
  
  const setHeightError = useCallback((value: boolean) => {
    updateActiveTile({ heightError: value });
  }, [updateActiveTile]);
  
  // Tiling solver state
  const [tilingWidthInput, setTilingWidthInput] = useState("6");
  const [tilingHeightInput, setTilingHeightInput] = useState("6");
  const [tilingWidth, setTilingWidth] = useState(6);
  const [tilingHeight, setTilingHeight] = useState(6);
  const [tilingWidthError, setTilingWidthError] = useState(false);
  const [tilingHeightError, setTilingHeightError] = useState(false);
  const [solving, setSolving] = useState(false);
  const [tilingResult, setTilingResult] = useState<TilingResult | HexTilingResult | TriTilingResult | null>(null);
  const [tilingError, setTilingError] = useState<string | null>(null);
  const [tilingStats, setTilingStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [solvedPolyformType, setSolvedPolyformType] = useState<PolyformType | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tilingSvgRef = useRef<SVGSVGElement | null>(null);
  
  // Debugging state
  const [highlightedPlacement, setHighlightedPlacement] = useState<number | null>(null);
  const [highlightedEdge, setHighlightedEdge] = useState<number | null>(null);
  const [edgeInfo, setEdgeInfo] = useState<{
    cellIndex: number;
    edgeIndex: number;
    isInternal: boolean;
    coord1: { q: number; r: number };
    coord2: { q: number; r: number } | null;
    direction: string;
  } | null>(null);
  const [coordsJsonInput, setCoordsJsonInput] = useState("");
  const [hideFills, setHideFills] = useState(false);
  
  // Maze generation state
  const [mazeResult, setMazeResult] = useState<MazeResult | null>(null);
  const [hexMazeResult, setHexMazeResult] = useState<HexMazeResult | null>(null);
  const [triMazeResult, setTriMazeResult] = useState<TriMazeResult | null>(null);
  const mazeSvgRef = useRef<SVGSVGElement | null>(null);
  
  // Download SVG function
  const handleDownloadSvg = useCallback(() => {
    if (!tilingSvgRef.current) return;
    downloadSvg(tilingSvgRef.current, `tiling-${tilingWidth}x${tilingHeight}.svg`);
  }, [tilingWidth, tilingHeight]);
  
  // Export tile coordinates as JSON
  const handleExportTileCoords = useCallback(() => {
    const json = exportCellsToJson(cells);
    const coords = JSON.parse(json);
    navigator.clipboard.writeText(json).then(() => {
      alert(`Copied ${coords.length} coordinates to clipboard!`);
    }).catch(() => {
      // Fallback: show in a prompt
      prompt("Copy these coordinates:", json);
    });
  }, [cells]);
  
  // Import tile coordinates from JSON
  const handleImportTileCoords = useCallback(() => {
    const result = parseCoordsJson(coordsJsonInput);
    if (!result) {
      alert("Invalid JSON: expected an array of {row, col} objects with numeric values");
      return;
    }
    
    const { coords, maxRow, maxCol } = result;
    
    // Create new grid
    const newWidth = Math.max(maxCol + 1, 3);
    const newHeight = Math.max(maxRow + 1, 3);
    const newCells = createEmptyBooleanGrid(newWidth, newHeight);
    
    for (const { row, col } of coords) {
      if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
        newCells[row][col] = true;
      }
    }
    
    setGridWidth(newWidth);
    setGridHeight(newHeight);
    setWidthInput(String(newWidth));
    setHeightInput(String(newHeight));
    setCells(newCells);
    setCoordsJsonInput("");
    alert(`Imported ${coords.length} coordinates`);
  }, [coordsJsonInput, setGridWidth, setGridHeight, setWidthInput, setHeightInput, setCells]);
  
  // Download placements as JSON
  const handleDownloadPlacementsJson = useCallback(() => {
    if (!tilingResult || !tilingResult.placements) return;
    
    const data = {
      gridWidth: tilingWidth,
      gridHeight: tilingHeight,
      polyformType: solvedPolyformType,
      numPlacements: tilingResult.placements.length,
      placements: tilingResult.placements.map((p, i) => ({
        index: i,
        id: p.id,
        transformIndex: p.transformIndex,
        cells: p.cells,
        ...(("offset" in p) ? { offset: p.offset } : {}),
      })),
    };
    
    downloadJson(data, `placements-${tilingWidth}x${tilingHeight}.json`);
  }, [tilingResult, tilingWidth, tilingHeight, solvedPolyformType]);
  
  // Generate maze from current solution (polyomino)
  const handleGenerateMaze = useCallback(() => {
    if (!tilingResult?.placements || solvedPolyformType !== "polyomino") return;
    
    // Cast to TilingResult since we checked solvedPolyformType === "polyomino"
    const placements = (tilingResult as TilingResult).placements!;
    const result = generateMaze(placements);
    setMazeResult(result);
  }, [tilingResult, solvedPolyformType]);
  
  // Generate hex maze from current solution (polyhex)
  const handleGenerateHexMaze = useCallback(() => {
    if (!tilingResult?.placements || solvedPolyformType !== "polyhex") return;
    
    // Cast to HexTilingResult since we checked solvedPolyformType === "polyhex"
    const placements = (tilingResult as HexTilingResult).placements!;
    const result = generateHexMaze(placements);
    setHexMazeResult(result);
  }, [tilingResult, solvedPolyformType]);
  
  // Generate triangle maze from current solution (polyiamond)
  const handleGenerateTriMaze = useCallback(() => {
    if (!tilingResult?.placements || solvedPolyformType !== "polyiamond") return;
    
    // Cast to TriTilingResult since we checked solvedPolyformType === "polyiamond"
    const placements = (tilingResult as TriTilingResult).placements!;
    const result = generateTriMaze(placements);
    setTriMazeResult(result);
  }, [tilingResult, solvedPolyformType]);
  
  // Download maze SVG
  const handleDownloadMazeSvg = useCallback(() => {
    if (!mazeSvgRef.current) return;
    downloadSvg(mazeSvgRef.current, `maze-${tilingWidth}x${tilingHeight}.svg`);
  }, [tilingWidth, tilingHeight]);
  
  // Highlight navigation
  const handlePrevPlacement = useCallback(() => {
    if (!tilingResult?.placements?.length) return;
    setHighlightedEdge(null); // Clear edge when changing placement
    setHighlightedPlacement(prev => {
      if (prev === null) return tilingResult.placements!.length - 1;
      return (prev - 1 + tilingResult.placements!.length) % tilingResult.placements!.length;
    });
  }, [tilingResult]);
  
  const handleNextPlacement = useCallback(() => {
    if (!tilingResult?.placements?.length) return;
    setHighlightedEdge(null); // Clear edge when changing placement
    setHighlightedPlacement(prev => {
      if (prev === null) return 0;
      return (prev + 1) % tilingResult.placements!.length;
    });
  }, [tilingResult]);
  
  const handleClearHighlight = useCallback(() => {
    setHighlightedPlacement(null);
    setHighlightedEdge(null);
  }, []);
  
  // Edge cycling handlers (only available when placement is highlighted)
  const handlePrevEdge = useCallback(() => {
    if (highlightedPlacement === null || !tilingResult?.placements?.[highlightedPlacement]) return;
    const numCells = tilingResult.placements[highlightedPlacement].cells.length;
    const totalEdges = numCells * 6; // 6 edges per hex cell
    setHighlightedEdge(prev => {
      if (prev === null) return totalEdges - 1;
      return (prev - 1 + totalEdges) % totalEdges;
    });
  }, [highlightedPlacement, tilingResult]);
  
  const handleNextEdge = useCallback(() => {
    if (highlightedPlacement === null || !tilingResult?.placements?.[highlightedPlacement]) return;
    const numCells = tilingResult.placements[highlightedPlacement].cells.length;
    const totalEdges = numCells * 6; // 6 edges per hex cell
    setHighlightedEdge(prev => {
      if (prev === null) return 0;
      return (prev + 1) % totalEdges;
    });
  }, [highlightedPlacement, tilingResult]);
  
  const handleClearEdge = useCallback(() => {
    setHighlightedEdge(null);
  }, []);
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Validate and apply tiling width on blur
  const handleTilingWidthBlur = useCallback(() => {
    const parsed = parseInt(tilingWidthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingWidthError(false);
      setTilingWidth(parsed);
    } else {
      setTilingWidthError(true);
    }
  }, [tilingWidthInput]);
  
  // Validate and apply tiling height on blur
  const handleTilingHeightBlur = useCallback(() => {
    const parsed = parseInt(tilingHeightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingHeightError(false);
      setTilingHeight(parsed);
    } else {
      setTilingHeightError(true);
    }
  }, [tilingHeightInput]);
  
  // Cancel solving (kill worker)
  const handleCancelSolving = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setSolving(false);
      setTilingError("Solving cancelled by user.");
      setTilingStats(null);
    }
  }, []);
  
  // Solve tiling problem
  const handleSolveTiling = useCallback(() => {
    // Gather all tiles with at least one filled cell
    const allTileCells = tiles.map(tile => tile.cells);
    const tilesWithContentIndices = allTileCells.map((cells, idx) => ({ cells, idx }))
      .filter(({ cells }) => cells.some(row => row.some(c => c)));
    
    if (tilesWithContentIndices.length === 0) {
      setTilingError("Please draw at least one tile first by clicking cells above.");
      return;
    }
    
    const tilesWithContent = tilesWithContentIndices.map(({ cells }) => cells);
    
    // Get roads for each tile (as array of edge key strings)
    const tileRoads = tiles.map(tile => Array.from(tile.roads));
    
    // Clear previous results
    setTilingResult(null);
    setTilingError(null);
    setTilingStats(null);
    setSolvedPolyformType(null);
    setMazeResult(null); // Clear maze when starting new solve
    setHexMazeResult(null); // Clear hex maze when starting new solve
    setTriMazeResult(null); // Clear tri maze when starting new solve
    setSolving(true);
    
    // Create worker
    const worker = new Worker(
      new URL("./problem/polyomino-tiling.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    
    worker.onmessage = (event) => {
      const response = event.data;
      
      if (response.messageType === "progress") {
        setTilingStats(response.stats);
      } else if (response.messageType === "result") {
        setSolving(false);
        if (response.success) {
          setTilingResult(response.result);
          setSolvedPolyformType(response.polyformType || "polyomino");
        } else {
          setTilingError(response.error || "Unknown error");
        }
        worker.terminate();
        workerRef.current = null;
      }
    };
    
    worker.onerror = (error) => {
      setSolving(false);
      setTilingError(`Worker error: ${error.message}`);
      worker.terminate();
      workerRef.current = null;
    };
    
    // Send request with all tiles that have content
    worker.postMessage({
      tiles: tilesWithContent,
      tileRoads,
      tilingWidth,
      tilingHeight,
      polyformType,
    });
  }, [tiles, tilingWidth, tilingHeight, polyformType]);
  
  // Validate and apply width on blur
  const handleWidthBlur = useCallback(() => {
    const parsed = parseInt(widthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setWidthError(false);
      if (parsed !== gridWidth) {
        setGridWidth(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyBooleanGrid(parsed, gridHeight);
          for (let row = 0; row < Math.min(prev.length, gridHeight); row++) {
            for (let col = 0; col < Math.min(prev[row].length, parsed); col++) {
              newCells[row][col] = prev[row][col];
            }
          }
          return newCells;
        });
      }
    } else {
      setWidthError(true);
    }
  }, [widthInput, gridWidth, gridHeight, setWidthError, setGridWidth, setCells]);
  
  // Validate and apply height on blur
  const handleHeightBlur = useCallback(() => {
    const parsed = parseInt(heightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setHeightError(false);
      if (parsed !== gridHeight) {
        setGridHeight(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyBooleanGrid(gridWidth, parsed);
          for (let row = 0; row < Math.min(prev.length, parsed); row++) {
            for (let col = 0; col < Math.min(prev[row].length, gridWidth); col++) {
              newCells[row][col] = prev[row][col];
            }
          }
          return newCells;
        });
      }
    } else {
      setHeightError(true);
    }
  }, [heightInput, gridHeight, gridWidth, setHeightError, setGridHeight, setCells]);
  
  // Toggle cell on click
  const handleCellClick = useCallback((row: number, col: number) => {
    setCells(prev => {
      const newCells = prev.map(r => [...r]);
      newCells[row][col] = !newCells[row][col];
      return newCells;
    });
    // When a cell is toggled off, remove any roads connected to it
    setRoads(prev => {
      const newRoads = new Set(prev);
      // Remove any edges connected to this cell
      for (const edgeKey of prev) {
        const parsed = parseEdgeKey(edgeKey);
        if (!parsed) continue;
        const { r1, c1, r2, c2 } = parsed;
        if ((r1 === row && c1 === col) || (r2 === row && c2 === col)) {
          newRoads.delete(edgeKey);
        }
      }
      return newRoads;
    });
  }, [setCells, setRoads]);
  
  // Toggle road on edge between two adjacent cells
  const handleEdgeClick = useCallback((row1: number, col1: number, row2: number, col2: number) => {
    const edgeKey = makeEdgeKey(row1, col1, row2, col2);
    setRoads(prev => {
      const newRoads = new Set(prev);
      if (newRoads.has(edgeKey)) {
        newRoads.delete(edgeKey);
      } else {
        newRoads.add(edgeKey);
      }
      return newRoads;
    });
  }, [setRoads]);
  
  // Rotate the polyform
  const handleRotate = useCallback(() => {
    setCells(prev => {
      let rotated: boolean[][];
      switch (polyformType) {
        case "polyomino":
          rotated = rotatePolyomino(prev);
          break;
        case "polyhex":
          rotated = rotatePolyhex(prev);
          break;
        case "polyiamond":
          rotated = rotatePolyiamond(prev);
          break;
        default:
          rotated = prev;
      }
      // Update dimensions to match rotated shape (clamped to max 50)
      const newHeight = Math.min(rotated.length, 50);
      const newWidth = Math.min(rotated[0]?.length ?? 0, 50);
      setGridHeight(newHeight);
      setGridWidth(newWidth);
      setHeightInput(String(newHeight));
      setWidthInput(String(newWidth));
      // Clear any error states since dimensions are now valid
      setWidthError(false);
      setHeightError(false);
      return rotated;
    });
    // Transform roads for polyomino rotation (90° clockwise)
    if (polyformType === "polyomino") {
      setRoads(prev => {
        const newRoads = new Set<EdgeKey>();
        const oldHeight = gridHeight;
        for (const edgeKey of prev) {
          const parsed = parseEdgeKey(edgeKey);
          if (!parsed) continue;
          const { r1, c1, r2, c2 } = parsed;
          // Rotation 90° CW: (row, col) -> (col, height - 1 - row)
          const nr1 = c1;
          const nc1 = oldHeight - 1 - r1;
          const nr2 = c2;
          const nc2 = oldHeight - 1 - r2;
          const newKey = makeEdgeKey(nr1, nc1, nr2, nc2);
          newRoads.add(newKey);
        }
        return newRoads;
      });
    } else {
      // Clear roads for non-polyomino types
      setRoads(new Set<EdgeKey>());
    }
  }, [polyformType, setCells, setGridHeight, setGridWidth, setHeightInput, setWidthInput, setWidthError, setHeightError, setRoads, gridHeight]);
  
  // Flip horizontally (geometry-correct per polyform type)
  const handleFlipH = useCallback(() => {
    setCells(prev => {
      let next: boolean[][];
      switch (polyformType) {
        case "polyomino":
          next = flipHorizontal(prev);
          break;
        case "polyhex":
          next = transformPolyhex(prev, "flipH");
          break;
        case "polyiamond":
          next = transformPolyiamond(prev, "flipH");
          break;
        default:
          next = prev;
      }

      const newHeight = Math.min(next.length, 50);
      const newWidth = Math.min(next[0]?.length ?? 0, 50);
      setGridHeight(newHeight);
      setGridWidth(newWidth);
      setHeightInput(String(newHeight));
      setWidthInput(String(newWidth));
      setWidthError(false);
      setHeightError(false);

      return next;
    });
    // Transform roads for polyomino horizontal flip
    if (polyformType === "polyomino") {
      setRoads(prev => {
        const newRoads = new Set<EdgeKey>();
        const oldWidth = gridWidth;
        for (const edgeKey of prev) {
          const parsed = parseEdgeKey(edgeKey);
          if (!parsed) continue;
          const { r1, c1, r2, c2 } = parsed;
          // Flip horizontally: (row, col) -> (row, width - 1 - col)
          const nc1 = oldWidth - 1 - c1;
          const nc2 = oldWidth - 1 - c2;
          const newKey = makeEdgeKey(r1, nc1, r2, nc2);
          newRoads.add(newKey);
        }
        return newRoads;
      });
    } else {
      setRoads(new Set<EdgeKey>());
    }
  }, [polyformType, setCells, setGridHeight, setGridWidth, setHeightInput, setWidthInput, setWidthError, setHeightError, setRoads, gridWidth]);
  
  // Flip vertically (geometry-correct per polyform type)
  const handleFlipV = useCallback(() => {
    setCells(prev => {
      let next: boolean[][];
      switch (polyformType) {
        case "polyomino":
          next = flipVertical(prev);
          break;
        case "polyhex":
          next = transformPolyhex(prev, "flipV");
          break;
        case "polyiamond":
          next = transformPolyiamond(prev, "flipV");
          break;
        default:
          next = prev;
      }

      const newHeight = Math.min(next.length, 50);
      const newWidth = Math.min(next[0]?.length ?? 0, 50);
      setGridHeight(newHeight);
      setGridWidth(newWidth);
      setHeightInput(String(newHeight));
      setWidthInput(String(newWidth));
      setWidthError(false);
      setHeightError(false);

      return next;
    });
    // Transform roads for polyomino vertical flip
    if (polyformType === "polyomino") {
      setRoads(prev => {
        const newRoads = new Set<EdgeKey>();
        const oldHeight = gridHeight;
        for (const edgeKey of prev) {
          const parsed = parseEdgeKey(edgeKey);
          if (!parsed) continue;
          const { r1, c1, r2, c2 } = parsed;
          // Flip vertically: (row, col) -> (height - 1 - row, col)
          const nr1 = oldHeight - 1 - r1;
          const nr2 = oldHeight - 1 - r2;
          const newKey = makeEdgeKey(nr1, c1, nr2, c2);
          newRoads.add(newKey);
        }
        return newRoads;
      });
    } else {
      setRoads(new Set<EdgeKey>());
    }
  }, [polyformType, setCells, setGridHeight, setGridWidth, setHeightInput, setWidthInput, setWidthError, setHeightError, setRoads, gridHeight]);
  
  // Clear the grid
  const handleClear = useCallback(() => {
    setCells(createEmptyBooleanGrid(gridWidth, gridHeight));
    setRoads(new Set<EdgeKey>());
  }, [gridWidth, gridHeight, setCells, setRoads]);
  
  // Change polyform type
  const handleTypeChange = useCallback((newType: PolyformType) => {
    setPolyformType(newType);
    // Reset all tiles when changing type
    setTiles([createEmptyTileState(8, 8)]);
    setActiveTileIndex(0);
  }, []);
  
  // Add a new tile
  const handleAddTile = useCallback(() => {
    setTiles(prev => {
      const newTiles = [...prev, createEmptyTileState(8, 8)];
      // Use setTimeout to set the active index after the state update
      // to avoid stale closure issues
      setActiveTileIndex(newTiles.length - 1);
      return newTiles;
    });
  }, []);
  
  // Remove the active tile (if there's more than one)
  const handleRemoveTile = useCallback(() => {
    setTiles(prev => {
      if (prev.length <= 1) return prev;
      const newTiles = prev.filter((_, i) => i !== activeTileIndex);
      // Adjust active index if it's now out of bounds
      if (activeTileIndex >= newTiles.length) {
        setActiveTileIndex(newTiles.length - 1);
      }
      return newTiles;
    });
  }, [activeTileIndex]);
  
  // Switch to a specific tile
  const handleSelectTile = useCallback((index: number) => {
    setTiles(prev => {
      if (index >= 0 && index < prev.length) {
        setActiveTileIndex(index);
      }
      return prev;
    });
  }, []);
  
  // Count filled cells
  const filledCount = useMemo(() => {
    let count = 0;
    for (const row of cells) {
      for (const cell of row) {
        if (cell) count++;
      }
    }
    return count;
  }, [cells]);
  
  return (
    <div className="app">
      <h1>🧩 Polyform Explorer</h1>
      <p className="description">
        Build polyforms by clicking cells to toggle them on/off. 
        Use the rotation and flip buttons to transform your shape.
      </p>
      

      {/* Controls */}
      <PolyformControls
        polyformType={polyformType}
        onTypeChange={handleTypeChange}
        widthInput={widthInput}
        heightInput={heightInput}
        widthError={widthError}
        heightError={heightError}
        onWidthInputChange={(v) => { setWidthInput(v); setWidthError(false); }}
        onHeightInputChange={(v) => { setHeightInput(v); setHeightError(false); }}
        onWidthBlur={handleWidthBlur}
        onHeightBlur={handleHeightBlur}
        onRotate={handleRotate}
        onFlipH={handleFlipH}
        onFlipV={handleFlipV}
        onClear={handleClear}
        onExportTileCoords={handleExportTileCoords}
        coordsJsonInput={coordsJsonInput}
        onCoordsJsonInputChange={setCoordsJsonInput}
        onImportTileCoords={handleImportTileCoords}
        filledCount={filledCount}
      />

      {/* Tile Tabs Navigation */}
      <div style={{ 
        marginTop: "16px",
        marginBottom: "8px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
      }}>
        {/* Tab buttons for each tile */}
        {tiles.map((tile, index) => {
          const tileFilledCount = tile.cells.reduce((sum, row) => 
            sum + row.filter(c => c).length, 0
          );
          return (
            <button
              key={index}
              onClick={() => handleSelectTile(index)}
              style={{
                padding: "8px 16px",
                backgroundColor: index === activeTileIndex ? "#3498db" : "#e9ecef",
                color: index === activeTileIndex ? "white" : "#495057",
                border: "none",
                borderRadius: "4px 4px 0 0",
                cursor: "pointer",
                fontWeight: index === activeTileIndex ? "bold" : "normal",
                fontSize: "14px",
                transition: "background-color 0.2s",
              }}
            >
              Tile {index + 1} {tileFilledCount > 0 && `(${tileFilledCount})`}
            </button>
          );
        })}
        
        {/* Add Tile button */}
        <button
          onClick={handleAddTile}
          style={{
            padding: "8px 12px",
            backgroundColor: "#27ae60",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
          }}
          title="Add a new tile"
        >
          + Add Tile
        </button>
        
        {/* Remove Tile button (only if more than one tile) */}
        {tiles.length > 1 && (
          <button
            onClick={handleRemoveTile}
            style={{
              padding: "8px 12px",
              backgroundColor: "#e74c3c",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
              fontWeight: "bold",
            }}
            title="Remove current tile"
          >
            − Remove
          </button>
        )}
      </div>

      
      {/* Grid */}
      <div style={{ 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: "2px solid #3498db",
        display: "inline-block",
      }}>
        {polyformType === "polyomino" && (
          <SquareGrid
            cells={cells}
            roads={roads}
            onCellClick={handleCellClick}
            onEdgeClick={handleEdgeClick}
          />
        )}
        {polyformType === "polyhex" && (
          <HexGrid
            cells={cells}
            onCellClick={handleCellClick}
          />
        )}
        {polyformType === "polyiamond" && (
          <TriangleGrid
            cells={cells}
            onCellClick={handleCellClick}
          />
        )}
      </div>
      
      {/* Tiling Solver Section */}
      <div style={{ 
        marginTop: "24px", 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: "1px solid #dee2e6",
      }}>
        <h3 style={{ marginTop: 0, marginBottom: "12px" }}>🧩 Tiling Solver</h3>
        <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "16px" }}>
          Try to tile a grid of the specified size using rotations, translations, and flips of your polyform.
        </p>
        
        {/* Tiling Grid Size Inputs */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Tiling Width:</label>
            <input
              type="text"
              value={tilingWidthInput}
              onChange={(e) => {
                setTilingWidthInput(e.target.value);
                setTilingWidthError(false);
              }}
              onBlur={handleTilingWidthBlur}
              disabled={solving}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: tilingWidthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: tilingWidthError ? "#fdecea" : "white",
              }}
            />
            {tilingWidthError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Tiling Height:</label>
            <input
              type="text"
              value={tilingHeightInput}
              onChange={(e) => {
                setTilingHeightInput(e.target.value);
                setTilingHeightError(false);
              }}
              onBlur={handleTilingHeightBlur}
              disabled={solving}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: tilingHeightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: tilingHeightError ? "#fdecea" : "white",
              }}
            />
            {tilingHeightError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <button
            onClick={handleSolveTiling}
            disabled={solving}
            style={{
              padding: "8px 20px",
              backgroundColor: solving ? "#95a5a6" : "#27ae60",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: solving ? "not-allowed" : "pointer",
              fontWeight: "bold",
            }}
          >
            {solving ? "⏳ Solving..." : "🔍 Solve Tiling"}
          </button>
          {solving && (
            <button
              onClick={handleCancelSolving}
              style={{
                padding: "8px 20px",
                backgroundColor: "#e74c3c",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              ❌ Cancel
            </button>
          )}
        </div>
        
        {/* Progress/Stats display */}
        {solving && tilingStats && (
          <div style={{ 
            padding: "12px", 
            backgroundColor: "#e8f4fd", 
            borderRadius: "4px",
            marginBottom: "12px",
            fontSize: "14px",
          }}>
            <strong>Solving...</strong> {tilingStats.numVars.toLocaleString()} variables, {tilingStats.numClauses.toLocaleString()} clauses
          </div>
        )}
        
        {/* Error display */}
        {tilingError && (
          <div style={{ 
            padding: "12px", 
            backgroundColor: "#fdecea", 
            borderRadius: "4px",
            marginBottom: "12px",
            color: "#e74c3c",
            fontSize: "14px",
          }}>
            ❌ {tilingError}
          </div>
        )}
        
        {/* Result display */}
        {tilingResult && (
          <div style={{ marginTop: "16px" }}>
            {tilingResult.satisfiable ? (
              <>
                <div style={{ 
                  padding: "12px", 
                  backgroundColor: "#d4edda", 
                  borderRadius: "4px",
                  marginBottom: "12px",
                  color: "#155724",
                  fontSize: "14px",
                }}>
                  ✅ <strong>Solution found!</strong> Using {tilingResult.placements?.length ?? 0} tile placements.
                  {tilingResult.tileTypeCounts && tilingResult.tileTypeCounts.length > 1 && (
                    <>
                      <br/>
                      <span style={{ fontSize: "12px", color: "#155724" }}>
                        {tilingResult.tileTypeCounts.map((count, index) => 
                          `Tile ${index + 1}: ${count}`
                        ).join(' • ')}
                      </span>
                    </>
                  )}
                  <br/>
                  <span style={{ fontSize: "12px", color: "#6c757d" }}>
                    ({tilingResult.stats.numPlacements.toLocaleString()} total possible placements, {tilingResult.stats.numVariables.toLocaleString()} vars, {tilingResult.stats.numClauses.toLocaleString()} clauses)
                  </span>
                </div>
                {solvedPolyformType === "polyhex" ? (
                  <HexTilingViewer
                    width={tilingWidth}
                    height={tilingHeight}
                    placements={(tilingResult as HexTilingResult).placements || []}
                    svgRef={tilingSvgRef}
                    highlightedPlacement={highlightedPlacement}
                    highlightedEdge={highlightedEdge}
                    onEdgeInfo={setEdgeInfo}
                    hideFills={hideFills}
                  />
                ) : solvedPolyformType === "polyiamond" ? (
                  <TriTilingViewer
                    width={tilingWidth}
                    height={tilingHeight}
                    placements={(tilingResult as TriTilingResult).placements || []}
                    svgRef={tilingSvgRef}
                    highlightedPlacement={highlightedPlacement}
                  />
                ) : (
                  <TilingViewer
                    width={tilingWidth}
                    height={tilingHeight}
                    placements={(tilingResult as TilingResult).placements || []}
                    svgRef={tilingSvgRef}
                    highlightedPlacement={highlightedPlacement}
                  />
                )}
                
                {/* Highlight controls */}
                <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={handlePrevPlacement}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#007bff",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    ◀ Prev
                  </button>
                  <button
                    onClick={handleNextPlacement}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#007bff",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Next ▶
                  </button>
                  <button
                    onClick={handleClearHighlight}
                    disabled={highlightedPlacement === null}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: highlightedPlacement !== null ? "#6c757d" : "#adb5bd",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: highlightedPlacement !== null ? "pointer" : "not-allowed",
                      fontSize: "14px",
                    }}
                  >
                    Clear Highlight
                  </button>
                  {highlightedPlacement !== null && tilingResult.placements && (
                    <span style={{ fontSize: "14px", color: "#495057" }}>
                      Placement <strong>{highlightedPlacement + 1}</strong> of {tilingResult.placements.length}
                      {" | "}
                      Transform: <strong>{tilingResult.placements[highlightedPlacement].transformIndex}</strong>
                    </span>
                  )}
                </div>
                
                {/* Hide fills checkbox (only for polyhex) */}
                {solvedPolyformType === "polyhex" && (
                  <div style={{ marginTop: "12px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px" }}>
                      <input
                        type="checkbox"
                        checked={hideFills}
                        onChange={(e) => setHideFills(e.target.checked)}
                        style={{ width: "16px", height: "16px", cursor: "pointer" }}
                      />
                      Hide filled hexes (show edges only)
                    </label>
                  </div>
                )}
                
                {/* Edge debugging controls (only for polyhex when placement is highlighted) */}
                {solvedPolyformType === "polyhex" && highlightedPlacement !== null && tilingResult.placements && (
                  <div style={{ 
                    marginTop: "12px", 
                    padding: "12px", 
                    backgroundColor: "#f8f9fa", 
                    borderRadius: "4px",
                    border: "1px solid #dee2e6"
                  }}>
                    <div style={{ marginBottom: "8px", fontWeight: "bold", fontSize: "14px" }}>
                      🔍 Edge Debugging
                    </div>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={handlePrevEdge}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        ◀ Prev Edge
                      </button>
                      <button
                        onClick={handleNextEdge}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        Next Edge ▶
                      </button>
                      <button
                        onClick={handleClearEdge}
                        disabled={highlightedEdge === null}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: highlightedEdge !== null ? "#6c757d" : "#adb5bd",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: highlightedEdge !== null ? "pointer" : "not-allowed",
                          fontSize: "12px",
                        }}
                      >
                        Clear Edge
                      </button>
                      {highlightedEdge !== null && (
                        <span style={{ fontSize: "12px", color: "#495057" }}>
                          Edge <strong>{highlightedEdge + 1}</strong> of {tilingResult.placements[highlightedPlacement].cells.length * 6}
                        </span>
                      )}
                    </div>
                    {edgeInfo && (
                      <div style={{ 
                        marginTop: "8px", 
                        padding: "8px", 
                        backgroundColor: edgeInfo.isInternal ? "#d4edda" : "#f8d7da",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontFamily: "monospace"
                      }}>
                        <div>
                          <strong>Edge Type:</strong> {edgeInfo.isInternal ? "🔗 INTERNAL" : "🚧 EXTERNAL"} (direction: {edgeInfo.direction})
                        </div>
                        <div>
                          <strong>Cell:</strong> ({edgeInfo.coord1.q}, {edgeInfo.coord1.r}) [cell #{edgeInfo.cellIndex + 1}, edge #{edgeInfo.edgeIndex}]
                        </div>
                        {edgeInfo.isInternal && edgeInfo.coord2 && (
                          <div>
                            <strong>Connects to:</strong> ({edgeInfo.coord2.q}, {edgeInfo.coord2.r})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Download buttons */}
                <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    onClick={handleDownloadSvg}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#6c757d",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    💾 Save as SVG
                  </button>
                  <button
                    onClick={handleDownloadPlacementsJson}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#17a2b8",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    📥 Download Placements JSON
                  </button>
                  {/* Generate Maze button - only for polyomino */}
                  {solvedPolyformType === "polyomino" && (
                    <button
                      onClick={handleGenerateMaze}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "#9b59b6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "bold",
                      }}
                    >
                      🌲 Generate Maze
                    </button>
                  )}
                  {/* Generate Hex Maze button - only for polyhex */}
                  {solvedPolyformType === "polyhex" && (
                    <button
                      onClick={handleGenerateHexMaze}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "#9b59b6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "bold",
                      }}
                    >
                      🌲 Generate Maze
                    </button>
                  )}
                  {/* Generate Triangle Maze button - only for polyiamond */}
                  {solvedPolyformType === "polyiamond" && (
                    <button
                      onClick={handleGenerateTriMaze}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "#9b59b6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "bold",
                      }}
                    >
                      🌲 Generate Maze
                    </button>
                  )}
                </div>
                
                {/* Maze Result Display (polyomino) */}
                {mazeResult && solvedPolyformType === "polyomino" && (
                  <div style={{ 
                    marginTop: "24px", 
                    padding: "16px", 
                    backgroundColor: "#f0f8ff", 
                    borderRadius: "8px",
                    border: "2px solid #9b59b6",
                  }}>
                    <h4 style={{ marginTop: 0, marginBottom: "12px", color: "#9b59b6" }}>
                      🌲 Generated Maze
                    </h4>
                    <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "12px" }}>
                      A spanning tree connects all tile placements. One wall has been randomly opened 
                      for each edge in the spanning tree, creating a maze.
                    </p>
                    <MazeViewer
                      width={tilingWidth}
                      height={tilingHeight}
                      walls={mazeResult.remainingWalls}
                      svgRef={mazeSvgRef}
                    />
                    <div style={{ marginTop: "12px", fontSize: "14px", color: "#495057" }}>
                      <strong>{mazeResult.remainingWalls.length}</strong> walls remaining 
                      ({mazeResult.spanningTreeEdges.length} walls opened via spanning tree)
                    </div>
                    <button
                      onClick={handleDownloadMazeSvg}
                      style={{
                        marginTop: "12px",
                        padding: "8px 16px",
                        backgroundColor: "#9b59b6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      💾 Save Maze as SVG
                    </button>
                  </div>
                )}
                
                {/* Hex Maze Result Display (polyhex) */}
                {hexMazeResult && solvedPolyformType === "polyhex" && (
                  <div style={{ 
                    marginTop: "24px", 
                    padding: "16px", 
                    backgroundColor: "#f0f8ff", 
                    borderRadius: "8px",
                    border: "2px solid #9b59b6",
                  }}>
                    <h4 style={{ marginTop: 0, marginBottom: "12px", color: "#9b59b6" }}>
                      🌲 Generated Hex Maze
                    </h4>
                    <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "12px" }}>
                      A spanning tree connects all tile placements. One wall has been randomly opened 
                      for each edge in the spanning tree, creating a maze.
                    </p>
                    <HexMazeViewer
                      width={tilingWidth}
                      height={tilingHeight}
                      walls={hexMazeResult.remainingWalls}
                      svgRef={mazeSvgRef}
                    />
                    <div style={{ marginTop: "12px", fontSize: "14px", color: "#495057" }}>
                      <strong>{hexMazeResult.remainingWalls.length}</strong> walls remaining 
                      ({hexMazeResult.spanningTreeEdges.length} walls opened via spanning tree)
                    </div>
                    <button
                      onClick={handleDownloadMazeSvg}
                      style={{
                        marginTop: "12px",
                        padding: "8px 16px",
                        backgroundColor: "#9b59b6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      💾 Save Maze as SVG
                    </button>
                  </div>
                )}
                
                {/* Triangle Maze Result Display (polyiamond) */}
                {triMazeResult && solvedPolyformType === "polyiamond" && (
                  <div style={{ 
                    marginTop: "24px", 
                    padding: "16px", 
                    backgroundColor: "#f0f8ff", 
                    borderRadius: "8px",
                    border: "2px solid #9b59b6",
                  }}>
                    <h4 style={{ marginTop: 0, marginBottom: "12px", color: "#9b59b6" }}>
                      🌲 Generated Triangle Maze
                    </h4>
                    <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "12px" }}>
                      A spanning tree connects all tile placements. One wall has been randomly opened 
                      for each edge in the spanning tree, creating a maze.
                    </p>
                    <TriMazeViewer
                      width={tilingWidth}
                      height={tilingHeight}
                      walls={triMazeResult.remainingWalls}
                      svgRef={mazeSvgRef}
                    />
                    <div style={{ marginTop: "12px", fontSize: "14px", color: "#495057" }}>
                      <strong>{triMazeResult.remainingWalls.length}</strong> walls remaining 
                      ({triMazeResult.spanningTreeEdges.length} walls opened via spanning tree)
                    </div>
                    <button
                      onClick={handleDownloadMazeSvg}
                      style={{
                        marginTop: "12px",
                        padding: "8px 16px",
                        backgroundColor: "#9b59b6",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                      }}
                    >
                      💾 Save Maze as SVG
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ 
                padding: "12px", 
                backgroundColor: "#fff3cd", 
                borderRadius: "4px",
                color: "#856404",
                fontSize: "14px",
              }}>
                ⚠️ <strong>No tiling possible</strong> with this tile for a {tilingWidth}×{tilingHeight} grid.
                <br/>
                <span style={{ fontSize: "12px", color: "#6c757d" }}>
                  ({tilingResult.stats.numPlacements.toLocaleString()} possible placements checked, {tilingResult.stats.numVariables.toLocaleString()} vars, {tilingResult.stats.numClauses.toLocaleString()} clauses)
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PolyformExplorer;
