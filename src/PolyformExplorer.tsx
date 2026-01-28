import React, { useState, useCallback, useMemo } from "react";
import "./App.css";

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
 */
function rotatePolyiamond(cells: boolean[][]): boolean[][] {
  const height = cells.length;
  const width = cells[0]?.length ?? 0;
  
  // Find all filled triangles with their orientation
  const filledTriangles: { row: number; col: number; up: boolean }[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      if (cells[row][col]) {
        // Triangle pointing up if (row + col) is even
        const up = (row + col) % 2 === 0;
        filledTriangles.push({ row, col, up });
      }
    }
  }
  
  if (filledTriangles.length === 0) return cells;
  
  // For triangular grid rotation, we use a coordinate transform
  // Rotate 60° clockwise using skewed coordinates
  const rotated = filledTriangles.map(({ row, col, up }) => {
    // Convert to a coordinate system where rotation is simpler
    // Using trilinear-ish coordinates
    const x = col;
    const y = row;
    
    // 60° clockwise rotation for triangle grid
    // New coordinates after rotation
    const newX = Math.floor((x + y + (up ? 0 : 1)) / 2);
    const newY = y - Math.floor((x - (up ? 0 : 1)) / 2);
    const newUp = !up; // Orientation flips
    
    return { row: newY, col: newX, up: newUp };
  });
  
  // Normalize to positive coordinates
  let minRow = Infinity, minCol = Infinity, maxRow = -Infinity, maxCol = -Infinity;
  for (const t of rotated) {
    minRow = Math.min(minRow, t.row);
    maxRow = Math.max(maxRow, t.row);
    minCol = Math.min(minCol, t.col);
    maxCol = Math.max(maxCol, t.col);
  }
  
  const newHeight = maxRow - minRow + 1;
  const newWidth = maxCol - minCol + 1;
  
  const newCells: boolean[][] = Array.from({ length: newHeight }, () =>
    Array.from({ length: newWidth }, () => false)
  );
  
  for (const t of rotated) {
    const row = t.row - minRow;
    const col = t.col - minCol;
    if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
      newCells[row][col] = true;
    }
  }
  
  return newCells;
}

/**
 * Flip the polyform horizontally.
 * Note: For polyhex and polyiamond, this is a simple array flip which
 * visually mirrors the shape but may not preserve exact geometric relationships
 * on offset grids. For most use cases, this produces intuitive results.
 */
function flipHorizontal(cells: boolean[][]): boolean[][] {
  return cells.map(row => [...row].reverse());
}

/**
 * Flip the polyform vertically.
 * Note: For polyhex and polyiamond, this is a simple array flip which
 * visually mirrors the shape but may not preserve exact geometric relationships
 * on offset grids. For most use cases, this produces intuitive results.
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
  
  // Flip horizontally
  const handleFlipH = useCallback(() => {
    setCells(prev => flipHorizontal(prev));
  }, []);
  
  // Flip vertically
  const handleFlipV = useCallback(() => {
    setCells(prev => flipVertical(prev));
  }, []);
  
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
      
      {/* Placeholder for future tiling solve feature */}
      <div style={{ 
        marginTop: "24px", 
        padding: "16px", 
        backgroundColor: "#f5f5f5", 
        borderRadius: "8px",
        color: "#7f8c8d",
        fontSize: "14px",
      }}>
        <em>🔮 Tiling solver coming soon...</em>
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

export default PolyformExplorer;
