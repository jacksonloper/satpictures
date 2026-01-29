import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import "./App.css";
import type { TilingResult, Placement } from "./problem/polyomino-tiling";
import type { HexTilingResult, HexPlacement } from "./problem/polyhex-tiling";

/** Polyform type - determines the grid geometry */
type PolyformType = "polyomino" | "polyhex" | "polyiamond";

/**
 * Create an empty grid of cells.
 */
function createEmptyGrid(width: number, height: number): boolean[][] {
  return Array.from({ length: height }, () => 
    Array.from({ length: width }, () => false)
  );
}

/**
 * Rotate the polyform 90 degrees clockwise (for square/polyomino).
 * For hex and iamond, rotation is 60 degrees.
 */
function rotatePolyomino(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  // Rotate 90° clockwise: new[col][height-1-row] = old[row][col]
  const newCells: boolean[][] = Array.from({ length: width }, () =>
    Array.from({ length: height }, () => false)
  );
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      newCells[col][height - 1 - row] = cells[row][col];
    }
  }
  return newCells;
}

/**
 * Rotate hex grid 60° clockwise.
 * Uses cube coordinates for rotation, then converts back.
 */
function rotatePolyhex(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Find all filled cells and convert to cube coordinates
  const filledCubes: { x: number; y: number; z: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (cells[row][col]) {
        // Offset to cube (odd-r layout)
        const x = col - Math.floor(row / 2);
        const z = row;
        const y = -x - z;
        filledCubes.push({ x, y, z });
      }
    }
  }
  
  if (filledCubes.length === 0) return cells;
  
  // Rotate 60° clockwise in cube coords: (x, y, z) -> (-z, -x, -y)
  const rotatedCubes = filledCubes.map(({ x, y, z }) => ({
    x: -z,
    y: -x,
    z: -y,
  }));
  
  // Find bounding box and normalize to positive coordinates
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const cube of rotatedCubes) {
    minX = Math.min(minX, cube.x);
    maxX = Math.max(maxX, cube.x);
    minZ = Math.min(minZ, cube.z);
    maxZ = Math.max(maxZ, cube.z);
  }
  
  // Calculate new dimensions
  const newHeight = maxZ - minZ + 1;
  const newWidth = maxX - minX + 1 + Math.floor(newHeight / 2);
  
  // Create new grid and fill
  const newCells: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );
  
  for (const cube of rotatedCubes) {
    const row = cube.z - minZ;
    const col = cube.x - minX + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newCells[row][col] = true;
    }
  }
  
  return newCells;
}

/**
 * Rotate polyiamond (triangle grid) 60° clockwise.
 * Correct implementation via rotating each triangle's lattice vertices.
 */
function rotatePolyiamond(cells: boolean[][]): boolean[][] {
  return transformPolyiamond(cells, "rot60");
}

type PolyhexTransform = "flipH" | "flipV";
type PolyiamondTransform = "flipH" | "flipV" | "rot60";

/**
 * Convert polyhex (odd-r offset) filled cells -> axial (q,r),
 * apply a transform, then rasterize back to odd-r offset grid.
 *
 * These reflections are defined to match screen axes:
 * - Horizontal flip: mirror across a vertical screen line (x -> -x), keep r
 * - Vertical flip: mirror across a horizontal screen line (y -> -y), r -> -r
 *
 * Using pointy-top axial pixel relation: x ~ q + r/2, y ~ r.
 */
function transformPolyhex(cells: boolean[][], t: PolyhexTransform): boolean[][] {
  const height = cells.length;
  if (height === 0) return cells;
  const width = cells[0]?.length ?? 0;
  if (width === 0) return cells;

  const filled: { q: number; r: number }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;
      // odd-r -> axial(q,r) with r=row
      const q = col - Math.floor(row / 2);
      const r = row;
      filled.push({ q, r });
    }
  }
  if (filled.length === 0) return cells;

  const transformed = filled.map(({ q, r }) => {
    if (t === "flipH") {
      // x' = -(q + r/2), y' = r  => q' = -q - r, r' = r
      return { q: -q - r, r };
    } else {
      // y' = -r, x' same => q' = q + r, r' = -r
      return { q: q + r, r: -r };
    }
  });

  // Bounding in axial (q,r)
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const coord of transformed) {
    minQ = Math.min(minQ, coord.q);
    maxQ = Math.max(maxQ, coord.q);
    minR = Math.min(minR, coord.r);
    maxR = Math.max(maxR, coord.r);
  }

  const newHeight = maxR - minR + 1;
  const newWidth = (maxQ - minQ + 1) + Math.floor(newHeight / 2);

  const out: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );

  for (const { q, r } of transformed) {
    const row = r - minR;
    const col = (q - minQ) + Math.floor(row / 2);
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      out[row][col] = true;
    }
  }

  return out;
}

/**
 * Polyiamond transforms via lattice-vertex representation.
 *
 * We treat each small triangle as having 3 vertices on the triangular lattice.
 * Use lattice coords (u,v) where physical x = u + v/2 and y = v*(sqrt3/2).
 *
 * Vertex conversions:
 *   X = 2x (in half-edge units) = 2u + v
 *   Y = v
 * so u = (X - Y)/2, v = Y
 *
 * Transforms (matching screen axes used by the renderer):
 *   rot60 CW: (u,v) -> (u+v, -u)
 *   flipH:    x -> -x => (u,v) -> (-u - v, v)
 *   flipV:    y -> -y => (u,v) -> (u+v, -v)
 */
function transformPolyiamond(cells: boolean[][], t: PolyiamondTransform): boolean[][] {
  const height = cells.length;
  if (height === 0) return cells;
  const width = cells[0]?.length ?? 0;
  if (width === 0) return cells;

  type Vertex = { X: number; Y: number }; // integer "half-edge" coords (X step = half base, Y step = row)
  type UV = { u: number; v: number };

  const toUV = (p: Vertex): UV => {
    // IMPORTANT:
    // Our triangle vertices always satisfy (X - Y) is ODD.
    // So we use the "odd sublattice" mapping: u = (X - Y - 1)/2 (integer), v = Y (integer).
    return { u: (p.X - p.Y - 1) / 2, v: p.Y };
  };

  const fromUV = (p: UV): Vertex => {
    // Inverse of the above: X = 2u + v + 1, Y = v
    return { X: 2 * p.u + p.v + 1, Y: p.v };
  };

  const applyUV = (p: UV): UV => {
    if (t === "rot60") return { u: p.u + p.v, v: -p.u };
    if (t === "flipH") return { u: -p.u - p.v, v: p.v };
    // flipV
    return { u: p.u + p.v, v: -p.v };
  };

  // Build triangle list as 3 vertices each
  const tris: Vertex[][] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (!cells[row][col]) continue;

      const isUp = (row + col) % 2 === 0;

      // Using the renderer geometry in integer half-edge coords:
      // x = col*(base/2) => X = col
      // y = row*(height) => Y = row
      if (isUp) {
        // Up triangle vertices: (col+1,row), (col,row+1), (col+2,row+1)
        tris.push([
          { X: col + 1, Y: row },
          { X: col, Y: row + 1 },
          { X: col + 2, Y: row + 1 },
        ]);
      } else {
        // Down triangle vertices: (col,row), (col+2,row), (col+1,row+1)
        tris.push([
          { X: col, Y: row },
          { X: col + 2, Y: row },
          { X: col + 1, Y: row + 1 },
        ]);
      }
    }
  }

  if (tris.length === 0) return cells;

  // Transform all triangles
  const transformedTris: Vertex[][] = tris.map((verts) =>
    verts.map((vtx) => fromUV(applyUV(toUV(vtx))))
  );

  // Convert transformed triangles back into (row,col) cells
  const cellsOut: { row: number; col: number }[] = [];

  for (const verts of transformedTris) {
    const Ys = verts.map((p) => p.Y);
    const minY = Math.min(...Ys);
    const maxY = Math.max(...Ys);

    // Each elementary triangle spans exactly 1 in Y in this coordinate system
    if (maxY - minY !== 1) continue;

    const low = verts.filter((p) => p.Y === minY);
    const high = verts.filter((p) => p.Y === maxY);

    if (low.length === 1 && high.length === 2) {
      // Up triangle: base at maxY, col = minX among base vertices, row = minY
      const col = Math.min(high[0].X, high[1].X);
      const row = minY;
      cellsOut.push({ row, col });
    } else if (low.length === 2 && high.length === 1) {
      // Down triangle: base at minY, col = minX among base vertices, row = minY
      const col = Math.min(low[0].X, low[1].X);
      const row = minY;
      cellsOut.push({ row, col });
    }
  }

  if (cellsOut.length === 0) return cells;

  // Normalize to positive row/col bounding box
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const p of cellsOut) {
    minRow = Math.min(minRow, p.row);
    maxRow = Math.max(maxRow, p.row);
    minCol = Math.min(minCol, p.col);
    maxCol = Math.max(maxCol, p.col);
  }

  // Base offsets to bring mins to 0
  const offRow = -minRow;
  let offCol = -minCol;

  // IMPORTANT: preserve (row+col)%2 orientation.
  // If offRow+offCol is odd, shift by 1 in col to maintain triangle parity.
  if (((offRow + offCol) & 1) !== 0) {
    offCol += 1;
  }

  const newHeight = maxRow + offRow + 1;
  const newWidth = maxCol + offCol + 1;

  const out: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );

  for (const p of cellsOut) {
    const r = p.row + offRow;
    const c = p.col + offCol;
    if (r >= 0 && r < newHeight && c >= 0 && c < newWidth) {
      out[r][c] = true;
    }
  }

  return out;
}

/**
 * Flip the polyform horizontally (simple array reverse).
 * Used for polyomino (square) grids where array reversal produces correct results.
 * For polyhex and polyiamond, use the geometry-correct transform functions instead.
 */
function flipHorizontal(cells: boolean[][]): boolean[][] {
  return cells.map(row => [...row].reverse());
}

/**
 * Flip the polyform vertically (simple array reverse).
 * Used for polyomino (square) grids where array reversal produces correct results.
 * For polyhex and polyiamond, use the geometry-correct transform functions instead.
 */
function flipVertical(cells: boolean[][]): boolean[][] {
  return [...cells].reverse();
}

/**
 * Polyform Explorer Component
 * Allows users to build polyomino, polyhex, or polyiamond shapes
 * with rotation and flip controls.
 */
export function PolyformExplorer() {
  const [polyformType, setPolyformType] = useState<PolyformType>("polyomino");
  const [gridWidth, setGridWidth] = useState(8);
  const [gridHeight, setGridHeight] = useState(8);
  const [cells, setCells] = useState<boolean[][]>(() => createEmptyGrid(8, 8));
  
  // Textbox input state (separate from actual values for validation)
  const [widthInput, setWidthInput] = useState("8");
  const [heightInput, setHeightInput] = useState("8");
  const [widthError, setWidthError] = useState(false);
  const [heightError, setHeightError] = useState(false);
  
  // Tiling solver state
  const [tilingWidthInput, setTilingWidthInput] = useState("6");
  const [tilingHeightInput, setTilingHeightInput] = useState("6");
  const [tilingWidth, setTilingWidth] = useState(6);
  const [tilingHeight, setTilingHeight] = useState(6);
  const [tilingWidthError, setTilingWidthError] = useState(false);
  const [tilingHeightError, setTilingHeightError] = useState(false);
  const [solving, setSolving] = useState(false);
  const [tilingResult, setTilingResult] = useState<TilingResult | HexTilingResult | null>(null);
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
  
  // Download SVG function
  const handleDownloadSvg = useCallback(() => {
    if (!tilingSvgRef.current) return;
    
    const svgElement = tilingSvgRef.current;
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgElement);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = `tiling-${tilingWidth}x${tilingHeight}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [tilingWidth, tilingHeight]);
  
  // Export tile coordinates as JSON
  const handleExportTileCoords = useCallback(() => {
    const coords: Array<{ row: number; col: number }> = [];
    for (let row = 0; row < cells.length; row++) {
      for (let col = 0; col < cells[row].length; col++) {
        if (cells[row][col]) {
          coords.push({ row, col });
        }
      }
    }
    const json = JSON.stringify(coords, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      alert(`Copied ${coords.length} coordinates to clipboard!`);
    }).catch(() => {
      // Fallback: show in a prompt
      prompt("Copy these coordinates:", json);
    });
  }, [cells]);
  
  // Import tile coordinates from JSON
  const handleImportTileCoords = useCallback(() => {
    try {
      const coords = JSON.parse(coordsJsonInput) as Array<{ row: number; col: number }>;
      if (!Array.isArray(coords)) {
        alert("Invalid JSON: expected an array of {row, col} objects");
        return;
      }
      
      // Find bounds
      let maxRow = 0, maxCol = 0;
      for (const { row, col } of coords) {
        if (typeof row !== "number" || typeof col !== "number") {
          alert("Invalid JSON: each item must have numeric 'row' and 'col' properties");
          return;
        }
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, col);
      }
      
      // Create new grid
      const newWidth = Math.max(maxCol + 1, 3);
      const newHeight = Math.max(maxRow + 1, 3);
      const newCells = createEmptyGrid(newWidth, newHeight);
      
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
    } catch (e) {
      alert(`Failed to parse JSON: ${e}`);
    }
  }, [coordsJsonInput]);
  
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
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = `placements-${tilingWidth}x${tilingHeight}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [tilingResult, tilingWidth, tilingHeight, solvedPolyformType]);
  
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
  
  // Solve tiling problem
  const handleSolveTiling = useCallback(() => {
    // Support polyomino and polyhex
    if (polyformType !== "polyomino" && polyformType !== "polyhex") {
      setTilingError("Tiling solver currently only supports polyomino (square) and polyhex (hexagon) tiles.");
      return;
    }
    
    // Check that tile has at least one cell
    const hasFilledCell = cells.some(row => row.some(c => c));
    if (!hasFilledCell) {
      setTilingError("Please draw a tile first by clicking cells above.");
      return;
    }
    
    // Clear previous results
    setTilingResult(null);
    setTilingError(null);
    setTilingStats(null);
    setSolvedPolyformType(null);
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
    
    // Send request with polyform type
    worker.postMessage({
      cells,
      tilingWidth,
      tilingHeight,
      polyformType,
    });
  }, [cells, tilingWidth, tilingHeight, polyformType]);
  
  // Validate and apply width on blur
  const handleWidthBlur = useCallback(() => {
    const parsed = parseInt(widthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setWidthError(false);
      if (parsed !== gridWidth) {
        setGridWidth(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyGrid(parsed, gridHeight);
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
  }, [widthInput, gridWidth, gridHeight]);
  
  // Validate and apply height on blur
  const handleHeightBlur = useCallback(() => {
    const parsed = parseInt(heightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setHeightError(false);
      if (parsed !== gridHeight) {
        setGridHeight(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyGrid(gridWidth, parsed);
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
  }, [heightInput, gridHeight, gridWidth]);
  
  // Toggle cell on click
  const handleCellClick = useCallback((row: number, col: number) => {
    setCells(prev => {
      const newCells = prev.map(r => [...r]);
      newCells[row][col] = !newCells[row][col];
      return newCells;
    });
  }, []);
  
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
  }, [polyformType]);
  
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
  }, [polyformType]);
  
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
  }, [polyformType]);
  
  // Clear the grid
  const handleClear = useCallback(() => {
    setCells(createEmptyGrid(gridWidth, gridHeight));
  }, [gridWidth, gridHeight]);
  
  // Change polyform type
  const handleTypeChange = useCallback((newType: PolyformType) => {
    setPolyformType(newType);
    // Reset grid when changing type
    setCells(createEmptyGrid(gridWidth, gridHeight));
  }, [gridWidth, gridHeight]);
  
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
      <div style={{ marginBottom: "20px" }}>
        {/* Polyform Type Selector */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ marginRight: "12px", fontWeight: "bold" }}>Type:</label>
          <select
            value={polyformType}
            onChange={(e) => handleTypeChange(e.target.value as PolyformType)}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              borderRadius: "4px",
              border: "1px solid #bdc3c7",
              cursor: "pointer",
            }}
          >
            <option value="polyomino">Polyomino (Square)</option>
            <option value="polyhex">Polyhex (Hexagon)</option>
            <option value="polyiamond">Polyiamond (Triangle)</option>
          </select>
        </div>
        
        {/* Grid Size Inputs */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Width:</label>
            <input
              type="text"
              value={widthInput}
              onChange={(e) => {
                setWidthInput(e.target.value);
                setWidthError(false); // Clear error while typing
              }}
              onBlur={handleWidthBlur}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: widthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: widthError ? "#fdecea" : "white",
              }}
            />
            {widthError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Height:</label>
            <input
              type="text"
              value={heightInput}
              onChange={(e) => {
                setHeightInput(e.target.value);
                setHeightError(false); // Clear error while typing
              }}
              onBlur={handleHeightBlur}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: heightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: heightError ? "#fdecea" : "white",
              }}
            />
            {heightError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
        </div>
        
        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={handleRotate}
            style={{
              padding: "8px 16px",
              backgroundColor: "#3498db",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            🔄 Rotate {polyformType === "polyomino" ? "90°" : "60°"}
          </button>
          <button
            onClick={handleFlipH}
            style={{
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ↔️ Flip H
          </button>
          <button
            onClick={handleFlipV}
            style={{
              padding: "8px 16px",
              backgroundColor: "#9b59b6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ↕️ Flip V
          </button>
          <button
            onClick={handleClear}
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
            onClick={handleExportTileCoords}
            style={{
              padding: "8px 16px",
              backgroundColor: "#17a2b8",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            title="Copy tile coordinates as JSON"
          >
            📋 Copy JSON
          </button>
        </div>
        
        {/* JSON Import */}
        <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={coordsJsonInput}
            onChange={(e) => setCoordsJsonInput(e.target.value)}
            placeholder='Paste JSON coords: [{"row":0,"col":0},...]'
            style={{
              padding: "6px 10px",
              borderRadius: "4px",
              border: "1px solid #bdc3c7",
              width: "300px",
              fontSize: "12px",
            }}
          />
          <button
            onClick={handleImportTileCoords}
            disabled={!coordsJsonInput.trim()}
            style={{
              padding: "6px 12px",
              backgroundColor: coordsJsonInput.trim() ? "#28a745" : "#95a5a6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: coordsJsonInput.trim() ? "pointer" : "not-allowed",
              fontSize: "12px",
            }}
          >
            📥 Import JSON
          </button>
        </div>
        
        {/* Stats */}
        <div style={{ marginTop: "12px", color: "#7f8c8d", fontSize: "14px" }}>
          Filled cells: <strong>{filledCount}</strong>
        </div>
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
            onCellClick={handleCellClick}
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
          {polyformType === "polyiamond" && (
            <span style={{ color: "#e74c3c", display: "block", marginTop: "8px" }}>
              ⚠️ Polyiamond (triangle) tiling is not yet supported.
            </span>
          )}
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
            disabled={solving || polyformType === "polyiamond"}
            style={{
              padding: "8px 20px",
              backgroundColor: solving ? "#95a5a6" : "#27ae60",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: solving || polyformType === "polyiamond" ? "not-allowed" : "pointer",
              fontWeight: "bold",
            }}
          >
            {solving ? "⏳ Solving..." : "🔍 Solve Tiling"}
          </button>
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
                <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
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
                </div>
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

/** Square grid for polyomino */
interface SquareGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
}

const SquareGrid: React.FC<SquareGridProps> = ({ cells, onCellClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  return (
    <svg
      width={width * cellSize + 2}
      height={height * cellSize + 2}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <rect
            key={`${rowIdx}-${colIdx}`}
            x={colIdx * cellSize + 1}
            y={rowIdx * cellSize + 1}
            width={cellSize - 1}
            height={cellSize - 1}
            fill={filled ? "#3498db" : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
    </svg>
  );
};

/** Hex grid for polyhex */
interface HexGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
}

const HexGrid: React.FC<HexGridProps> = ({ cells, onCellClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Hex geometry calculations for POINTY-TOP orientation:
  // - hexSize: radius from center to vertex (0.5 * cellSize for spacing)
  // - For pointy-top: hexWidth = sqrt(3) * size, hexHeight = 2 * size
  // - Pointy-top axial → pixel: x = size * sqrt(3) * (q + r/2), y = size * 3/2 * r
  const hexSize = cellSize * 0.5;
  const hexWidth = Math.sqrt(3) * hexSize;
  const horizSpacing = hexWidth;
  const vertSpacing = hexSize * 1.5; // 3/2 * size for pointy-top
  
  const svgWidth = width * horizSpacing + horizSpacing / 2 + 10;
  const svgHeight = height * vertSpacing + hexSize + 10;
  
  // Create hexagon path - POINTY-TOP orientation
  // Starting at angle PI/2 (90°) creates pointy-top orientation
  const createHexPath = (cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 2; // Pointy-top: start at 90°
      const x = cx + hexSize * Math.cos(angle);
      const y = cy + hexSize * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")} Z`;
  };
  
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => {
          // Odd-r offset for pointy-top: odd rows are shifted right by half a hex width
          const isOddRow = rowIdx % 2 === 1;
          const cx = colIdx * horizSpacing + horizSpacing / 2 + (isOddRow ? horizSpacing / 2 : 0) + 5;
          const cy = rowIdx * vertSpacing + hexSize + 5;
          
          return (
            <path
              key={`${rowIdx}-${colIdx}`}
              d={createHexPath(cx, cy)}
              fill={filled ? "#27ae60" : "#ecf0f1"}
              stroke="#bdc3c7"
              strokeWidth={1}
              style={{ cursor: "pointer" }}
              onClick={() => onCellClick(rowIdx, colIdx)}
            />
          );
        })
      )}
    </svg>
  );
};

/** Triangle grid for polyiamond */
interface TriangleGridProps {
  cells: boolean[][];
  onCellClick: (row: number, col: number) => void;
  cellSize?: number;
}

const TriangleGrid: React.FC<TriangleGridProps> = ({ cells, onCellClick, cellSize = 40 }) => {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Triangle geometry:
  // - triWidth: base of the equilateral triangle = cellSize
  // - triHeight: height = base * sqrt(3)/2 (standard equilateral triangle ratio)
  // - Triangles overlap horizontally by half their width (tessellation)
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  
  const svgWidth = (width + 1) * (triWidth / 2) + 10;
  const svgHeight = height * triHeight + 10;
  
  // Create triangle path (up-pointing or down-pointing)
  // Orientation alternates based on (row + col) % 2 for tessellation
  const createTriPath = (row: number, col: number): string => {
    const isUp = (row + col) % 2 === 0;
    const x = col * (triWidth / 2) + 5;
    const y = row * triHeight + 5;
    
    if (isUp) {
      // Up-pointing triangle: apex at top
      const p1 = `${x + triWidth / 2},${y}`;
      const p2 = `${x},${y + triHeight}`;
      const p3 = `${x + triWidth},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    } else {
      // Down-pointing triangle: apex at bottom
      const p1 = `${x},${y}`;
      const p2 = `${x + triWidth},${y}`;
      const p3 = `${x + triWidth / 2},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    }
  };
  
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ display: "block" }}
    >
      {cells.map((row, rowIdx) =>
        row.map((filled, colIdx) => (
          <path
            key={`${rowIdx}-${colIdx}`}
            d={createTriPath(rowIdx, colIdx)}
            fill={filled ? "#e74c3c" : "#ecf0f1"}
            stroke="#bdc3c7"
            strokeWidth={1}
            style={{ cursor: "pointer" }}
            onClick={() => onCellClick(rowIdx, colIdx)}
          />
        ))
      )}
    </svg>
  );
};

/** TilingViewer - displays the solved tiling */
interface TilingViewerProps {
  width: number;
  height: number;
  placements: Placement[];
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
}

// Generate a set of distinct colors for the placements
function getPlacementColor(index: number, highlighted?: number | null): string {
  // Use HSL for evenly distributed colors
  const hue = (index * 137.508) % 360; // Golden angle approximation
  const isHighlighted = highlighted === index;
  if (highlighted !== null && highlighted !== undefined && !isHighlighted) {
    // Dim non-highlighted placements
    return `hsl(${hue}, 30%, 80%)`;
  }
  return `hsl(${hue}, 70%, 60%)`;
}

const TilingViewer: React.FC<TilingViewerProps> = ({ 
  width, 
  height, 
  placements, 
  cellSize = 30,
  svgRef,
  highlightedPlacement 
}) => {
  // Calculate the bounds of the outer grid (including all tile overhangs)
  const { outerBounds, cellToPlacement } = useMemo(() => {
    let minRow = 0, maxRow = height - 1;
    let minCol = 0, maxCol = width - 1;
    
    const map = new Map<string, number>();
    
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        map.set(`${cell.row},${cell.col}`, index);
        minRow = Math.min(minRow, cell.row);
        maxRow = Math.max(maxRow, cell.row);
        minCol = Math.min(minCol, cell.col);
        maxCol = Math.max(maxCol, cell.col);
      }
    });
    
    return {
      outerBounds: { minRow, maxRow, minCol, maxCol },
      cellToPlacement: map,
    };
  }, [placements, width, height]);
  
  const outerWidth = outerBounds.maxCol - outerBounds.minCol + 1;
  const outerHeight = outerBounds.maxRow - outerBounds.minRow + 1;
  
  // Offset to convert from logical coordinates to SVG coordinates
  const offsetCol = -outerBounds.minCol;
  const offsetRow = -outerBounds.minRow;
  
  return (
    <div style={{ 
      padding: "16px", 
      backgroundColor: "white", 
      borderRadius: "8px",
      border: "1px solid #dee2e6",
      display: "inline-block",
    }}>
      <svg
        ref={svgRef}
        width={outerWidth * cellSize}
        height={outerHeight * cellSize}
        style={{ display: "block" }}
        role="img"
        aria-label={`Tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid with overhangs`}
      >
        <title>Tiling Solution Visualization</title>
        
        {/* Layer 1: Draw all cell fills - cells fully tile with no gaps */}
        {Array.from({ length: outerHeight }, (_, svgRowIdx) =>
          Array.from({ length: outerWidth }, (_, svgColIdx) => {
            // Convert SVG coordinates back to logical coordinates
            const logicalRow = svgRowIdx - offsetRow;
            const logicalCol = svgColIdx - offsetCol;
            const key = `${logicalRow},${logicalCol}`;
            const placementIndex = cellToPlacement.get(key);
            
            // Determine if this cell is in the inner grid
            const isInnerGrid = logicalRow >= 0 && logicalRow < height && 
                               logicalCol >= 0 && logicalCol < width;
            
            // Determine fill color
            let fill: string;
            if (placementIndex !== undefined) {
              fill = getPlacementColor(placementIndex, highlightedPlacement);
            } else if (isInnerGrid) {
              fill = "#ecf0f1"; // Empty inner cell (shouldn't happen in valid solution)
            } else {
              fill = "#f8f9fa"; // Empty outer cell (overhang area background)
            }
            
            return (
              <rect
                key={key}
                x={svgColIdx * cellSize}
                y={svgRowIdx * cellSize}
                width={cellSize}
                height={cellSize}
                fill={fill}
                stroke={fill}
                strokeWidth={0.5}
              />
            );
          })
        )}
        
        {/* Layer 1.5: Draw low-contrast overlay on cells outside the inner grid */}
        {Array.from({ length: outerHeight }, (_, svgRowIdx) =>
          Array.from({ length: outerWidth }, (_, svgColIdx) => {
            const logicalRow = svgRowIdx - offsetRow;
            const logicalCol = svgColIdx - offsetCol;
            const isInnerGrid = logicalRow >= 0 && logicalRow < height && 
                               logicalCol >= 0 && logicalCol < width;
            
            // Only draw overlay for outer cells
            if (isInnerGrid) return null;
            
            return (
              <rect
                key={`overlay-${logicalRow},${logicalCol}`}
                x={svgColIdx * cellSize}
                y={svgRowIdx * cellSize}
                width={cellSize}
                height={cellSize}
                fill="rgba(255, 255, 255, 0.35)"
              />
            );
          })
        )}
        
        {/* Layer 2: Draw interior grid lines (thin gray lines between cells within same tile) */}
        {/* Draw only the inner 80% of each line (10% to 90%) to avoid connecting across tile boundaries */}
        {placements.map((p, pIndex) => {
          const interiorEdges: { x1: number; y1: number; x2: number; y2: number }[] = [];
          
          for (const cell of p.cells) {
            const svgCol = cell.col + offsetCol;
            const svgRow = cell.row + offsetRow;
            const x = svgCol * cellSize;
            const y = svgRow * cellSize;
            
            // Only draw interior edges (where neighbor is same placement)
            // Right edge - only if neighbor to the right is same tile
            const rightKey = `${cell.row},${cell.col + 1}`;
            if (cellToPlacement.get(rightKey) === pIndex) {
              // Vertical line: shorten by 10% on each end
              const startY = y + cellSize * 0.1;
              const endY = y + cellSize * 0.9;
              interiorEdges.push({ x1: x + cellSize, y1: startY, x2: x + cellSize, y2: endY });
            }
            // Bottom edge - only if neighbor below is same tile
            const bottomKey = `${cell.row + 1},${cell.col}`;
            if (cellToPlacement.get(bottomKey) === pIndex) {
              // Horizontal line: shorten by 10% on each end
              const startX = x + cellSize * 0.1;
              const endX = x + cellSize * 0.9;
              interiorEdges.push({ x1: startX, y1: y + cellSize, x2: endX, y2: y + cellSize });
            }
          }
          
          return interiorEdges.map((edge, edgeIndex) => (
            <line
              key={`interior-${pIndex}-${edgeIndex}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#95a5a6"
              strokeWidth={0.5}
            />
          ));
        })}
        
        {/* Layer 3: Draw inner grid boundary (thick red border to distinguish from tile boundaries) */}
        <rect
          x={offsetCol * cellSize}
          y={offsetRow * cellSize}
          width={width * cellSize}
          height={height * cellSize}
          fill="none"
          stroke="#e74c3c"
          strokeWidth={3}
        />
        
        {/* Layer 4: Draw tile boundaries (thicker lines between different tiles - on top) */}
        {placements.map((p, pIndex) => {
          const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
          
          for (const cell of p.cells) {
            const svgCol = cell.col + offsetCol;
            const svgRow = cell.row + offsetRow;
            const x = svgCol * cellSize;
            const y = svgRow * cellSize;
            
            // Check each edge - draw if neighbor is different placement or empty
            // Top edge
            const topKey = `${cell.row - 1},${cell.col}`;
            if (cellToPlacement.get(topKey) !== pIndex) {
              edges.push({ x1: x, y1: y, x2: x + cellSize, y2: y });
            }
            // Bottom edge
            const bottomKey = `${cell.row + 1},${cell.col}`;
            if (cellToPlacement.get(bottomKey) !== pIndex) {
              edges.push({ x1: x, y1: y + cellSize, x2: x + cellSize, y2: y + cellSize });
            }
            // Left edge
            const leftKey = `${cell.row},${cell.col - 1}`;
            if (cellToPlacement.get(leftKey) !== pIndex) {
              edges.push({ x1: x, y1: y, x2: x, y2: y + cellSize });
            }
            // Right edge
            const rightKey = `${cell.row},${cell.col + 1}`;
            if (cellToPlacement.get(rightKey) !== pIndex) {
              edges.push({ x1: x + cellSize, y1: y, x2: x + cellSize, y2: y + cellSize });
            }
          }
          
          return edges.map((edge, edgeIndex) => (
            <line
              key={`${pIndex}-${edgeIndex}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#2c3e50"
              strokeWidth={2}
            />
          ));
        })}
      </svg>
    </div>
  );
};

/** HexTilingViewer - displays the solved hex tiling */
interface HexTilingViewerProps {
  width: number;
  height: number;
  placements: HexPlacement[];
  cellSize?: number;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  highlightedPlacement?: number | null;
  highlightedEdge?: number | null;
  onEdgeInfo?: (info: EdgeInfo | null) => void;
  hideFills?: boolean;  // Hide filled hexes to see edges only
}

// Info about a highlighted edge
interface EdgeInfo {
  cellIndex: number;
  edgeIndex: number;
  isInternal: boolean;
  coord1: { q: number; r: number };
  coord2: { q: number; r: number } | null;  // null if external
  direction: string;
}

const HexTilingViewer: React.FC<HexTilingViewerProps> = ({ 
  width, 
  height, 
  placements, 
  cellSize = 30,
  svgRef,
  highlightedPlacement,
  highlightedEdge,
  onEdgeInfo,
  hideFills = false
}) => {
  // Hex geometry for POINTY-TOP orientation
  // Using standard axial → pixel conversion:
  // x = size * sqrt(3) * (q + r/2)
  // y = size * 3/2 * r
  const hexSize = cellSize * 0.5;
  
  // Build axial coordinate maps and find bounds
  const { axialBounds, cellToPlacement, allAxialCells } = useMemo(() => {
    // Track all axial coordinates and which placement owns them
    const map = new Map<string, number>();
    const cells: Array<{ placementIndex: number; q: number; r: number }> = [];
    
    // Find bounds in axial space
    let minQ = 0, maxQ = width - 1;
    let minR = 0, maxR = height - 1;
    
    // Add inner grid cells (convert offset bounds to axial bounds)
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        // Convert offset to axial: q = col - floor(row/2)
        const q = c - Math.floor(r / 2);
        minQ = Math.min(minQ, q);
        maxQ = Math.max(maxQ, q);
      }
    }
    
    // Process placements - these are already in axial coordinates
    placements.forEach((p, index) => {
      for (const cell of p.cells) {
        const key = `${cell.q},${cell.r}`;
        map.set(key, index);
        cells.push({ placementIndex: index, q: cell.q, r: cell.r });
        minQ = Math.min(minQ, cell.q);
        maxQ = Math.max(maxQ, cell.q);
        minR = Math.min(minR, cell.r);
        maxR = Math.max(maxR, cell.r);
      }
    });
    
    return {
      axialBounds: { minQ, maxQ, minR, maxR },
      cellToPlacement: map,
      allAxialCells: cells,
    };
  }, [placements, width, height]);
  
  // Calculate pixel position from axial coordinates (pointy-top)
  const axialToPixel = useCallback((q: number, r: number) => {
    // Standard pointy-top conversion:
    // x = size * sqrt(3) * (q + r/2)
    // y = size * 3/2 * r
    const x = hexSize * Math.sqrt(3) * (q + r / 2);
    const y = hexSize * 1.5 * r;
    return { x, y };
  }, [hexSize]);
  
  // Calculate SVG offset to center everything with padding
  const svgOffset = useMemo(() => {
    const minPixel = axialToPixel(axialBounds.minQ, axialBounds.minR);
    return {
      x: -minPixel.x + hexSize * Math.sqrt(3) / 2 + 5,
      y: -minPixel.y + hexSize + 5,
    };
  }, [axialBounds, axialToPixel, hexSize]);
  
  // Calculate SVG dimensions
  const svgDimensions = useMemo(() => {
    const minPixel = axialToPixel(axialBounds.minQ, axialBounds.minR);
    const maxPixel = axialToPixel(axialBounds.maxQ, axialBounds.maxR);
    return {
      width: maxPixel.x - minPixel.x + hexSize * Math.sqrt(3) + 15,
      height: maxPixel.y - minPixel.y + hexSize * 2 + 15,
    };
  }, [axialBounds, axialToPixel, hexSize]);
  
  // Create hexagon path for pointy-top orientation
  const createHexPath = useCallback((cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Pointy-top: first vertex at top (90°)
      const angle = (Math.PI / 3) * i + Math.PI / 2;
      const x = cx + hexSize * Math.cos(angle);
      const y = cy + hexSize * Math.sin(angle);
      points.push(`${x},${y}`);
    }
    return `M ${points.join(" L ")} Z`;
  }, [hexSize]);
  
  // Get hex center in SVG coordinates from axial
  const getHexCenter = useCallback((q: number, r: number): { cx: number; cy: number } => {
    const pixel = axialToPixel(q, r);
    return {
      cx: pixel.x + svgOffset.x,
      cy: pixel.y + svgOffset.y,
    };
  }, [axialToPixel, svgOffset]);
  
  // Get hex vertices for border drawing
  const getHexVertices = useCallback((cx: number, cy: number): Array<{ x: number; y: number }> => {
    const vertices: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i + Math.PI / 2;
      vertices.push({
        x: cx + hexSize * Math.cos(angle),
        y: cy + hexSize * Math.sin(angle),
      });
    }
    return vertices;
  }, [hexSize]);
  
  // Get 6 axial neighbors with edge indices for border drawing
  // In SVG coordinates (Y increases downward), with angle starting at 90°:
  //   v0: 90° → BOTTOM (sin(90°)=1 means +Y), v1: 150° → lower-left, v2: 210° → upper-left
  //   v3: 270° → TOP (sin(270°)=-1 means -Y), v4: 330° → upper-right, v5: 30° → lower-right
  // Edge i connects vertex i to vertex (i+1)%6:
  //   edge 0: v0→v1 (faces SW), edge 1: v1→v2 (faces W), edge 2: v2→v3 (faces NW)
  //   edge 3: v3→v4 (faces NE), edge 4: v4→v5 (faces E), edge 5: v5→v0 (faces SE)
  const getAxialNeighbors = useCallback((q: number, r: number): Array<{ q: number; r: number; edgeIndex: number }> => {
    return [
      { q: q + 1, r: r - 1, edgeIndex: 3 }, // Upper-right (NE) → edge 3 (v3→v4)
      { q: q + 1, r: r, edgeIndex: 4 },     // Right (E) → edge 4 (v4→v5)
      { q: q, r: r + 1, edgeIndex: 5 },     // Lower-right (SE) → edge 5 (v5→v0)
      { q: q - 1, r: r + 1, edgeIndex: 0 }, // Lower-left (SW) → edge 0 (v0→v1)
      { q: q - 1, r: r, edgeIndex: 1 },     // Left (W) → edge 1 (v1→v2)
      { q: q, r: r - 1, edgeIndex: 2 },     // Upper-left (NW) → edge 2 (v2→v3)
    ];
  }, []);
  
  // Check if axial coord is in inner grid (need to convert to offset and check bounds)
  const isInInnerGrid = useCallback((q: number, r: number): boolean => {
    // Convert axial to offset: row = r, col = q + floor(r/2)
    const row = r;
    const col = q + Math.floor(r / 2);
    return row >= 0 && row < height && col >= 0 && col < width;
  }, [width, height]);
  
  // Generate all cells to render
  const allCells = useMemo(() => {
    const cells: Array<{ q: number; r: number; placementIndex: number | undefined; isInner: boolean }> = [];
    const seen = new Set<string>();
    
    // Add all placement cells
    for (const { q, r, placementIndex } of allAxialCells) {
      const key = `${q},${r}`;
      if (!seen.has(key)) {
        seen.add(key);
        cells.push({ q, r, placementIndex, isInner: isInInnerGrid(q, r) });
      }
    }
    
    // Add empty inner grid cells
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const q = col - Math.floor(row / 2);
        const r = row;
        const key = `${q},${r}`;
        if (!seen.has(key)) {
          seen.add(key);
          const placementIndex = cellToPlacement.get(key);
          cells.push({ q, r, placementIndex, isInner: true });
        }
      }
    }
    
    return cells;
  }, [allAxialCells, cellToPlacement, width, height, isInInnerGrid]);
  
  // Direction names for each edge
  const edgeDirections = ['SW', 'W', 'NW', 'NE', 'E', 'SE'];
  
  // Compute edge info for highlighted edge
  const highlightedEdgeInfo = useMemo(() => {
    if (highlightedPlacement === null || highlightedPlacement === undefined || highlightedEdge === null || highlightedEdge === undefined) {
      return null;
    }
    
    const placement = placements[highlightedPlacement];
    if (!placement) return null;
    
    const numCells = placement.cells.length;
    if (numCells === 0) return null;
    
    const cellIndex = Math.floor(highlightedEdge / 6);
    const edgeIndex = highlightedEdge % 6;
    
    if (cellIndex >= numCells) return null;
    
    const cell = placement.cells[cellIndex];
    const neighbors = [
      { q: cell.q + 1, r: cell.r - 1, edgeIndex: 3, direction: 'NE' },
      { q: cell.q + 1, r: cell.r, edgeIndex: 4, direction: 'E' },
      { q: cell.q, r: cell.r + 1, edgeIndex: 5, direction: 'SE' },
      { q: cell.q - 1, r: cell.r + 1, edgeIndex: 0, direction: 'SW' },
      { q: cell.q - 1, r: cell.r, edgeIndex: 1, direction: 'W' },
      { q: cell.q, r: cell.r - 1, edgeIndex: 2, direction: 'NW' },
    ];
    
    // Find which neighbor corresponds to this edge
    const neighbor = neighbors.find(n => n.edgeIndex === edgeIndex);
    if (!neighbor) return null;
    
    // Check if neighbor cell is in same placement
    const neighborKey = `${neighbor.q},${neighbor.r}`;
    const neighborPlacement = cellToPlacement.get(neighborKey);
    const isInternal = neighborPlacement === highlightedPlacement;
    
    return {
      cellIndex,
      edgeIndex,
      isInternal,
      coord1: { q: cell.q, r: cell.r },
      coord2: isInternal ? { q: neighbor.q, r: neighbor.r } : null,
      direction: edgeDirections[edgeIndex],
    } as EdgeInfo;
  }, [highlightedPlacement, highlightedEdge, placements, cellToPlacement, edgeDirections]);
  
  // Notify parent of edge info changes
  const prevEdgeInfoRef = useRef<string | null>(null);
  useEffect(() => {
    if (onEdgeInfo) {
      const infoStr = JSON.stringify(highlightedEdgeInfo);
      if (prevEdgeInfoRef.current !== infoStr) {
        prevEdgeInfoRef.current = infoStr;
        onEdgeInfo(highlightedEdgeInfo);
      }
    }
  }, [highlightedEdgeInfo, onEdgeInfo]);
  
  // Calculate highlighted edge geometry
  const highlightedEdgeGeometry = useMemo(() => {
    if (!highlightedEdgeInfo || highlightedPlacement === null || highlightedPlacement === undefined) return null;
    
    const placement = placements[highlightedPlacement];
    if (!placement) return null;
    
    const cell = placement.cells[highlightedEdgeInfo.cellIndex];
    if (!cell) return null;
    
    const { cx, cy } = getHexCenter(cell.q, cell.r);
    const vertices = getHexVertices(cx, cy);
    const v1 = vertices[highlightedEdgeInfo.edgeIndex];
    const v2 = vertices[(highlightedEdgeInfo.edgeIndex + 1) % 6];
    
    return { x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y };
  }, [highlightedEdgeInfo, highlightedPlacement, placements, getHexCenter, getHexVertices]);
  
  return (
    <div style={{ 
      padding: "16px", 
      backgroundColor: "white", 
      borderRadius: "8px",
      border: "1px solid #dee2e6",
      display: "inline-block",
    }}>
      <svg
        ref={svgRef}
        width={svgDimensions.width}
        height={svgDimensions.height}
        style={{ display: "block" }}
        role="img"
        aria-label={`Hex tiling solution showing ${placements.length} tile placements on a ${width}×${height} grid`}
      >
        <title>Hex Tiling Solution Visualization</title>
        
        {/* Layer 1: Draw all hex cell fills (skip if hideFills is true) */}
        {!hideFills && allCells.map(({ q, r, placementIndex, isInner }) => {
          const { cx, cy } = getHexCenter(q, r);
          
          let fill: string;
          if (placementIndex !== undefined) {
            fill = getPlacementColor(placementIndex, highlightedPlacement);
          } else if (isInner) {
            fill = "#ecf0f1"; // Empty inner cell
          } else {
            fill = "#f8f9fa"; // Empty outer cell
          }
          
          return (
            <path
              key={`fill-${q},${r}`}
              d={createHexPath(cx, cy)}
              fill={fill}
              stroke={fill}
              strokeWidth={0.5}
            />
          );
        })}
        
        {/* Layer 1.5: Draw overlay on cells outside the inner grid (skip if hideFills is true) */}
        {!hideFills && allCells
          .filter(({ isInner }) => !isInner)
          .map(({ q, r }) => {
            const { cx, cy } = getHexCenter(q, r);
            return (
              <path
                key={`overlay-${q},${r}`}
                d={createHexPath(cx, cy)}
                fill="rgba(255, 255, 255, 0.35)"
              />
            );
          })}
        
        {/* Layer 2: Draw interior edges (thin gray lines between cells in same tile) */}
        {/* Use edge deduplication: edge (A,B) is same as (B,A) */}
        {(() => {
          const seenEdges = new Set<string>();
          const interiorEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
          
          for (const { placementIndex, q, r } of allAxialCells) {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            const neighbors = getAxialNeighbors(q, r);
            
            for (const neighbor of neighbors) {
              const neighborKey = `${neighbor.q},${neighbor.r}`;
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              if (neighborPlacement === placementIndex) {
                // Interior edge - between two cells of same tile
                // Normalize edge key for deduplication (sort coordinate-pair strings)
                const a = `${q},${r}`;
                const b = `${neighbor.q},${neighbor.r}`;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const v1 = vertices[neighbor.edgeIndex];
                  const v2 = vertices[(neighbor.edgeIndex + 1) % 6];
                  // Shorten the line by 10% on each end for visual separation
                  const dx = v2.x - v1.x;
                  const dy = v2.y - v1.y;
                  interiorEdges.push({
                    x1: v1.x + dx * 0.1,
                    y1: v1.y + dy * 0.1,
                    x2: v2.x - dx * 0.1,
                    y2: v2.y - dy * 0.1,
                  });
                }
              }
            }
          }
          
          return interiorEdges.map((edge, idx) => (
            <line
              key={`interior-${idx}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#bdc3c7"
              strokeWidth={0.5}
            />
          ));
        })()}
        
        {/* Layer 3: Draw inner grid boundary */}
        {allCells
          .filter(({ isInner }) => isInner)
          .map(({ q, r }) => {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            const neighbors = getAxialNeighbors(q, r);
            
            const boundaryEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
            
            for (const neighbor of neighbors) {
              if (!isInInnerGrid(neighbor.q, neighbor.r)) {
                // This edge is on the boundary
                const v1 = vertices[neighbor.edgeIndex];
                const v2 = vertices[(neighbor.edgeIndex + 1) % 6];
                boundaryEdges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
              }
            }
            
            return boundaryEdges.map((edge, edgeIndex) => (
              <line
                key={`boundary-${q},${r}-${edgeIndex}`}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                stroke="#e74c3c"
                strokeWidth={3}
              />
            ));
          })}
        
        {/* Layer 4: Draw tile boundaries (thick black lines between different tiles) */}
        {(() => {
          const seenEdges = new Set<string>();
          const exteriorEdges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
          
          for (const { placementIndex, q, r } of allAxialCells) {
            const { cx, cy } = getHexCenter(q, r);
            const vertices = getHexVertices(cx, cy);
            const neighbors = getAxialNeighbors(q, r);
            
            for (const neighbor of neighbors) {
              const neighborKey = `${neighbor.q},${neighbor.r}`;
              const neighborPlacement = cellToPlacement.get(neighborKey);
              
              // Draw boundary if neighbor is different tile or empty
              if (neighborPlacement !== placementIndex) {
                // Normalize edge key for deduplication (sort coordinate-pair strings)
                const a = `${q},${r}`;
                const b = `${neighbor.q},${neighbor.r}`;
                const edgeKey = a < b ? `${a}|${b}` : `${b}|${a}`;
                if (!seenEdges.has(edgeKey)) {
                  seenEdges.add(edgeKey);
                  const v1 = vertices[neighbor.edgeIndex];
                  const v2 = vertices[(neighbor.edgeIndex + 1) % 6];
                  exteriorEdges.push({ x1: v1.x, y1: v1.y, x2: v2.x, y2: v2.y });
                }
              }
            }
          }
          
          return exteriorEdges.map((edge, idx) => (
            <line
              key={`tileBoundary-${idx}`}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              stroke="#2c3e50"
              strokeWidth={2}
            />
          ));
        })()}
        
        {/* Layer 5: Highlighted edge (bright cyan, thick) */}
        {highlightedEdgeGeometry && (
          <line
            x1={highlightedEdgeGeometry.x1}
            y1={highlightedEdgeGeometry.y1}
            x2={highlightedEdgeGeometry.x2}
            y2={highlightedEdgeGeometry.y2}
            stroke="#00ffff"
            strokeWidth={4}
          />
        )}
      </svg>
    </div>
  );
};

export default PolyformExplorer;
