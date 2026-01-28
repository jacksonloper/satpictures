import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import "./App.css";
import type { TilingSolverRequest, TilingSolverResponse, Placement } from "./problem";
import TilingWorker from "./problem/tiling.worker?worker";

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
  const [targetWidthInput, setTargetWidthInput] = useState("6");
  const [targetHeightInput, setTargetHeightInput] = useState("6");
  const [targetWidthError, setTargetWidthError] = useState(false);
  const [targetHeightError, setTargetHeightError] = useState(false);
  const [solving, setSolving] = useState(false);
  const [solverResult, setSolverResult] = useState<{
    satisfiable: boolean;
    placements: Placement[];
    stats?: {
      numVars: number;
      numClauses: number;
      numPlacements: number;
      numTransforms: number;
    };
  } | null>(null);
  const [solverError, setSolverError] = useState<string | null>(null);
  
  // Worker reference
  const workerRef = useRef<Worker | null>(null);
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
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
  
  // Validate target width
  const validateTargetWidth = useCallback((value: string): number | null => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      return parsed;
    }
    return null;
  }, []);
  
  // Validate target height
  const validateTargetHeight = useCallback((value: string): number | null => {
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      return parsed;
    }
    return null;
  }, []);
  
  // Solve tiling
  const handleSolve = useCallback(() => {
    // Validate inputs
    const targetWidth = validateTargetWidth(targetWidthInput);
    const targetHeight = validateTargetHeight(targetHeightInput);
    
    if (targetWidth === null) {
      setTargetWidthError(true);
      return;
    }
    if (targetHeight === null) {
      setTargetHeightError(true);
      return;
    }
    
    // Check that tile has at least one cell
    if (filledCount === 0) {
      setSolverError("Please draw a tile with at least one cell.");
      return;
    }
    
    // Start solving
    setSolving(true);
    setSolverResult(null);
    setSolverError(null);
    
    // Terminate existing worker if any
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    
    // Create new worker
    const worker = new TilingWorker();
    workerRef.current = worker;
    
    worker.onmessage = (event: MessageEvent<TilingSolverResponse>) => {
      const response = event.data;
      
      if (response.messageType === "progress") {
        // Progress update - ignore for now
        return;
      }
      
      // Result received
      setSolving(false);
      
      if (!response.success) {
        setSolverError(response.error ?? "Unknown error occurred");
        return;
      }
      
      setSolverResult({
        satisfiable: response.satisfiable,
        placements: response.placements,
        stats: response.stats,
      });
    };
    
    worker.onerror = (error) => {
      setSolving(false);
      setSolverError(`Worker error: ${error.message}`);
    };
    
    // Send request
    const request: TilingSolverRequest = {
      tileCells: cells,
      polyformType,
      targetWidth,
      targetHeight,
    };
    worker.postMessage(request);
  }, [cells, polyformType, targetWidthInput, targetHeightInput, filledCount, validateTargetWidth, validateTargetHeight]);
  
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
        backgroundColor: "#f5f5f5", 
        borderRadius: "8px",
      }}>
        <h3 style={{ marginTop: 0, marginBottom: "16px" }}>🔮 Tiling Solver</h3>
        
        {/* Target grid dimensions */}
        <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <label style={{ marginRight: "8px" }}>Target Width:</label>
            <input
              type="text"
              value={targetWidthInput}
              onChange={(e) => {
                setTargetWidthInput(e.target.value);
                setTargetWidthError(false);
              }}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: targetWidthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: targetWidthError ? "#fdecea" : "white",
              }}
            />
            {targetWidthError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <div>
            <label style={{ marginRight: "8px" }}>Target Height:</label>
            <input
              type="text"
              value={targetHeightInput}
              onChange={(e) => {
                setTargetHeightInput(e.target.value);
                setTargetHeightError(false);
              }}
              style={{
                width: "60px",
                padding: "8px",
                fontSize: "14px",
                borderRadius: "4px",
                border: targetHeightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
                backgroundColor: targetHeightError ? "#fdecea" : "white",
              }}
            />
            {targetHeightError && (
              <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
                Enter an integer (1-50)
              </span>
            )}
          </div>
          <button
            onClick={handleSolve}
            disabled={solving || filledCount === 0}
            style={{
              padding: "8px 24px",
              backgroundColor: solving ? "#95a5a6" : "#27ae60",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: solving || filledCount === 0 ? "not-allowed" : "pointer",
              fontWeight: "bold",
            }}
          >
            {solving ? "Solving..." : "Solve Tiling"}
          </button>
        </div>
        
        {/* Error message */}
        {solverError && (
          <div style={{ 
            padding: "12px", 
            backgroundColor: "#fdecea", 
            borderRadius: "4px",
            color: "#e74c3c",
            marginBottom: "16px",
          }}>
            {solverError}
          </div>
        )}
        
        {/* Solver result */}
        {solverResult && (
          <div style={{ marginTop: "16px" }}>
            {!solverResult.satisfiable ? (
              <div style={{ 
                padding: "12px", 
                backgroundColor: "#fff3cd", 
                borderRadius: "4px",
                color: "#856404",
              }}>
                <strong>No solution found.</strong> The tile cannot tile a {targetWidthInput}×{targetHeightInput} grid.
              </div>
            ) : (
              <div>
                <div style={{ 
                  padding: "12px", 
                  backgroundColor: "#d4edda", 
                  borderRadius: "4px",
                  color: "#155724",
                  marginBottom: "16px",
                }}>
                  <strong>Solution found!</strong> {solverResult.placements.length} tile(s) placed.
                </div>
                
                {/* Solution grid viewer */}
                <div style={{ 
                  padding: "16px", 
                  backgroundColor: "#f8f9fa", 
                  borderRadius: "8px",
                  border: "2px solid #27ae60",
                  display: "inline-block",
                }}>
                  {polyformType === "polyomino" && (
                    <TilingResultSquareGrid
                      placements={solverResult.placements}
                      targetWidth={parseInt(targetWidthInput, 10)}
                      targetHeight={parseInt(targetHeightInput, 10)}
                    />
                  )}
                  {polyformType === "polyhex" && (
                    <TilingResultHexGrid
                      placements={solverResult.placements}
                      targetWidth={parseInt(targetWidthInput, 10)}
                      targetHeight={parseInt(targetHeightInput, 10)}
                    />
                  )}
                  {polyformType === "polyiamond" && (
                    <TilingResultTriangleGrid
                      placements={solverResult.placements}
                      targetWidth={parseInt(targetWidthInput, 10)}
                      targetHeight={parseInt(targetHeightInput, 10)}
                    />
                  )}
                </div>
                
                {/* Stats */}
                {solverResult.stats && (
                  <div style={{ marginTop: "12px", color: "#7f8c8d", fontSize: "12px" }}>
                    SAT: {solverResult.stats.numVars} variables, {solverResult.stats.numClauses} clauses | 
                    Transforms: {solverResult.stats.numTransforms} | Placements: {solverResult.stats.numPlacements}
                  </div>
                )}
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
  
  // Hex geometry calculations:
  // - hexSize: radius from center to vertex (0.5 * cellSize for spacing)
  // - hexWidth: flat-to-flat width = sqrt(3) * radius (standard hex geometry)
  // - hexHeight: point-to-point height = 2 * radius
  // - vertSpacing: 0.75 of height because hexes overlap vertically by 1/4
  const hexSize = cellSize * 0.5;
  const hexWidth = Math.sqrt(3) * hexSize;
  const hexHeight = 2 * hexSize;
  const horizSpacing = hexWidth;
  const vertSpacing = hexHeight * 0.75;
  
  const svgWidth = width * horizSpacing + horizSpacing / 2 + 10;
  const svgHeight = height * vertSpacing + hexSize + 10;
  
  // Create hexagon path - 6 vertices at 60° (PI/3) intervals
  // Starting offset of -PI/6 (-30°) creates a flat-top orientation
  const createHexPath = (cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
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
          // Odd-r offset: odd rows are shifted right by half a hex width
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

// ============ TILING RESULT VIEWER COMPONENTS ============

/** Color palette for different tile placements */
const TILE_COLORS = [
  "#3498db", "#e74c3c", "#27ae60", "#9b59b6", "#f39c12",
  "#1abc9c", "#e67e22", "#2ecc71", "#8e44ad", "#16a085",
  "#d35400", "#c0392b", "#2980b9", "#7f8c8d", "#34495e",
];

function getTileColor(placementIndex: number): string {
  return TILE_COLORS[placementIndex % TILE_COLORS.length];
}

/** Props for tiling result grids */
interface TilingResultGridProps {
  placements: Placement[];
  targetWidth: number;
  targetHeight: number;
  cellSize?: number;
}

/** Square grid result viewer for polyomino tiling */
const TilingResultSquareGrid: React.FC<TilingResultGridProps> = ({
  placements,
  targetWidth,
  targetHeight,
  cellSize = 30,
}) => {
  // Build a map of which cell is covered by which placement
  const cellToPlacement = new Map<string, number>();
  for (let i = 0; i < placements.length; i++) {
    for (const cell of placements[i].coveredCells) {
      if (cell.row >= 0 && cell.row < targetHeight &&
          cell.col >= 0 && cell.col < targetWidth) {
        cellToPlacement.set(`${cell.row},${cell.col}`, i);
      }
    }
  }
  
  return (
    <svg
      width={targetWidth * cellSize + 2}
      height={targetHeight * cellSize + 2}
      style={{ display: "block" }}
    >
      {Array.from({ length: targetHeight }, (_, rowIdx) =>
        Array.from({ length: targetWidth }, (_, colIdx) => {
          const key = `${rowIdx},${colIdx}`;
          const placementIdx = cellToPlacement.get(key);
          const fill = placementIdx !== undefined ? getTileColor(placementIdx) : "#ecf0f1";
          
          return (
            <rect
              key={key}
              x={colIdx * cellSize + 1}
              y={rowIdx * cellSize + 1}
              width={cellSize - 1}
              height={cellSize - 1}
              fill={fill}
              stroke="#2c3e50"
              strokeWidth={1}
            />
          );
        })
      )}
    </svg>
  );
};

/** Hex grid result viewer for polyhex tiling */
const TilingResultHexGrid: React.FC<TilingResultGridProps> = ({
  placements,
  targetWidth,
  targetHeight,
  cellSize = 30,
}) => {
  // Build a map of which cell is covered by which placement
  const cellToPlacement = new Map<string, number>();
  for (let i = 0; i < placements.length; i++) {
    for (const cell of placements[i].coveredCells) {
      if (cell.row >= 0 && cell.row < targetHeight &&
          cell.col >= 0 && cell.col < targetWidth) {
        cellToPlacement.set(`${cell.row},${cell.col}`, i);
      }
    }
  }
  
  const hexSize = cellSize * 0.5;
  const hexWidth = Math.sqrt(3) * hexSize;
  const hexHeight = 2 * hexSize;
  const horizSpacing = hexWidth;
  const vertSpacing = hexHeight * 0.75;
  
  const svgWidth = targetWidth * horizSpacing + horizSpacing / 2 + 10;
  const svgHeight = targetHeight * vertSpacing + hexSize + 10;
  
  const createHexPath = (cx: number, cy: number): string => {
    const points: string[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
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
      {Array.from({ length: targetHeight }, (_, rowIdx) =>
        Array.from({ length: targetWidth }, (_, colIdx) => {
          const key = `${rowIdx},${colIdx}`;
          const placementIdx = cellToPlacement.get(key);
          const fill = placementIdx !== undefined ? getTileColor(placementIdx) : "#ecf0f1";
          
          const isOddRow = rowIdx % 2 === 1;
          const cx = colIdx * horizSpacing + horizSpacing / 2 + (isOddRow ? horizSpacing / 2 : 0) + 5;
          const cy = rowIdx * vertSpacing + hexSize + 5;
          
          return (
            <path
              key={key}
              d={createHexPath(cx, cy)}
              fill={fill}
              stroke="#2c3e50"
              strokeWidth={1}
            />
          );
        })
      )}
    </svg>
  );
};

/** Triangle grid result viewer for polyiamond tiling */
const TilingResultTriangleGrid: React.FC<TilingResultGridProps> = ({
  placements,
  targetWidth,
  targetHeight,
  cellSize = 30,
}) => {
  // Build a map of which cell is covered by which placement
  const cellToPlacement = new Map<string, number>();
  for (let i = 0; i < placements.length; i++) {
    for (const cell of placements[i].coveredCells) {
      if (cell.row >= 0 && cell.row < targetHeight &&
          cell.col >= 0 && cell.col < targetWidth) {
        cellToPlacement.set(`${cell.row},${cell.col}`, i);
      }
    }
  }
  
  const triWidth = cellSize;
  const triHeight = cellSize * Math.sqrt(3) / 2;
  
  const svgWidth = (targetWidth + 1) * (triWidth / 2) + 10;
  const svgHeight = targetHeight * triHeight + 10;
  
  const createTriPath = (row: number, col: number): string => {
    const isUp = (row + col) % 2 === 0;
    const x = col * (triWidth / 2) + 5;
    const y = row * triHeight + 5;
    
    if (isUp) {
      const p1 = `${x + triWidth / 2},${y}`;
      const p2 = `${x},${y + triHeight}`;
      const p3 = `${x + triWidth},${y + triHeight}`;
      return `M ${p1} L ${p2} L ${p3} Z`;
    } else {
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
      {Array.from({ length: targetHeight }, (_, rowIdx) =>
        Array.from({ length: targetWidth }, (_, colIdx) => {
          const key = `${rowIdx},${colIdx}`;
          const placementIdx = cellToPlacement.get(key);
          const fill = placementIdx !== undefined ? getTileColor(placementIdx) : "#ecf0f1";
          
          return (
            <path
              key={key}
              d={createTriPath(rowIdx, colIdx)}
              fill={fill}
              stroke="#2c3e50"
              strokeWidth={1}
            />
          );
        })
      )}
    </svg>
  );
};

export default PolyformExplorer;
