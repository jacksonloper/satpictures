/**
 * Orbifolds Explorer Page
 * 
 * Allows a user to:
 * - Select a wallpaper group (P1 or P2)
 * - Set a size n (creating an n×n coloring grid)
 * - Set an expansion count m (how many times to expand the lifted graph)
 * - Color in the grid cells (black/white)
 * - See the generated lifted graph
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  createOrbifoldGrid,
  setNodeColor,
  getNodeColor,
  type WallpaperGroupType,
  type ColorData,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  type LiftedGraph,
  type OrbifoldGrid,
  type Matrix3x3,
} from "./orbifoldbasics";
import "../App.css";

// Constants
const DEFAULT_SIZE = 3;
const DEFAULT_EXPANSION = 2;
const CELL_SIZE = 40;
const LIFTED_CELL_SIZE = 16;
const GRID_PADDING = 20;

/**
 * ValidatedInput component for number inputs.
 * Allows invalid values while typing, but cues the user and resets on blur if invalid.
 */
function ValidatedInput({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  const [inputValue, setInputValue] = useState(String(value));
  const [isValid, setIsValid] = useState(true);
  const [lastExternalValue, setLastExternalValue] = useState(value);

  // Update input when external value changes (not from our own onChange)
  // This pattern is recommended by React docs for derived state
  if (lastExternalValue !== value) {
    setLastExternalValue(value);
    setInputValue(String(value));
    setIsValid(true);
  }

  const validate = useCallback((val: string): boolean => {
    const num = parseInt(val, 10);
    return !isNaN(num) && num >= min && num <= max;
  }, [min, max]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    const valid = validate(newValue);
    setIsValid(valid);
    
    if (valid) {
      onChange(parseInt(newValue, 10));
    }
  };

  const handleBlur = () => {
    if (!isValid) {
      // Reset to last valid value
      setInputValue(String(value));
      setIsValid(true);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <label>{label}:</label>
      <input
        type="text"
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        style={{
          width: "60px",
          padding: "4px 8px",
          border: isValid ? "1px solid #ccc" : "2px solid #e74c3c",
          borderRadius: "4px",
          backgroundColor: isValid ? "white" : "#ffebee",
        }}
      />
      {!isValid && (
        <span style={{ color: "#e74c3c", fontSize: "12px" }}>
          ({min}-{max})
        </span>
      )}
    </div>
  );
}

/**
 * Coloring grid component for the orbifold.
 */
function ColoringGrid({
  n,
  grid,
  onCellClick,
}: {
  n: number;
  grid: OrbifoldGrid<ColorData>;
  onCellClick: (row: number, col: number) => void;
}) {
  const cellSize = CELL_SIZE;
  const width = n * cellSize + 2 * GRID_PADDING;
  const height = n * cellSize + 2 * GRID_PADDING;

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - GRID_PADDING;
    const y = e.clientY - rect.top - GRID_PADDING;
    
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    
    if (row >= 0 && row < n && col >= 0 && col < n) {
      onCellClick(row, col);
    }
  };

  return (
    <svg
      width={width}
      height={height}
      style={{ border: "1px solid #ccc", borderRadius: "4px", cursor: "pointer" }}
      onClick={handleSvgClick}
    >
      {/* Grid cells */}
      {Array.from({ length: n }, (_, row) =>
        Array.from({ length: n }, (_, col) => {
          const color = getNodeColor(grid, row, col);
          const x = GRID_PADDING + col * cellSize;
          const y = GRID_PADDING + row * cellSize;
          
          return (
            <rect
              key={`${row}-${col}`}
              x={x}
              y={y}
              width={cellSize}
              height={cellSize}
              fill={color === "black" ? "#2c3e50" : "white"}
              stroke="#7f8c8d"
              strokeWidth={1}
            />
          );
        })
      )}
    </svg>
  );
}

/**
 * Apply a 3x3 matrix to a 2D point (using homogeneous coordinates).
 */
function applyMatrix(matrix: Matrix3x3, x: number, y: number): { x: number; y: number } {
  const w = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  return {
    x: (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / w,
    y: (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / w,
  };
}

/**
 * Lifted graph renderer.
 * Positions each lifted node using: voltage × orbifold node coordinates.
 * Colors each node using the ExtraData color from the orbifold node.
 */
function LiftedGraphRenderer({
  liftedGraph,
  orbifoldGrid,
}: {
  liftedGraph: LiftedGraph<ColorData>;
  orbifoldGrid: OrbifoldGrid<ColorData>;
}) {
  const cellSize = LIFTED_CELL_SIZE;
  
  // Compute positions and bounds
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; color: "black" | "white" }>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    for (const [id, node] of liftedGraph.nodes) {
      const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
      if (!orbNode) continue;
      
      // Position = voltage × orbifold node coordinates
      const [ox, oy] = orbNode.coord;
      const pos = applyMatrix(node.voltage, ox, oy);
      
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
      
      const color = orbNode.data?.color ?? "white";
      positions.set(id, { x: pos.x, y: pos.y, color });
    }
    
    return { positions, minX, maxX, minY, maxY };
  }, [liftedGraph, orbifoldGrid]);

  const { positions, minX, maxX, minY, maxY } = nodePositions;
  
  // Compute SVG dimensions with padding
  const padding = GRID_PADDING * 2;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = cellSize;
  const width = rangeX * scale + 2 * padding;
  const height = rangeY * scale + 2 * padding;

  // Transform coordinates to SVG space
  const toSvgX = (x: number) => padding + (x - minX) * scale;
  const toSvgY = (y: number) => padding + (y - minY) * scale;

  return (
    <svg
      width={Math.max(width, 200)}
      height={Math.max(height, 200)}
      style={{ border: "1px solid #ccc", borderRadius: "4px", backgroundColor: "#f8f9fa" }}
    >
      {/* Edges */}
      {Array.from(liftedGraph.edges.values()).map((edge) => {
        const posA = positions.get(edge.a);
        const posB = positions.get(edge.b);
        if (!posA || !posB) return null;
        
        return (
          <line
            key={edge.id}
            x1={toSvgX(posA.x)}
            y1={toSvgY(posA.y)}
            x2={toSvgX(posB.x)}
            y2={toSvgY(posB.y)}
            stroke="#bdc3c7"
            strokeWidth={1}
          />
        );
      })}
      
      {/* Nodes */}
      {Array.from(positions.entries()).map(([id, pos]) => {
        const node = liftedGraph.nodes.get(id);
        const isInterior = node?.interior ?? false;
        
        return (
          <circle
            key={id}
            cx={toSvgX(pos.x)}
            cy={toSvgY(pos.y)}
            r={cellSize / 3}
            fill={pos.color === "black" ? "#2c3e50" : "white"}
            stroke={isInterior ? "#27ae60" : "#e74c3c"}
            strokeWidth={isInterior ? 1 : 2}
          />
        );
      })}
    </svg>
  );
}

/**
 * Main Orbifolds Explorer component.
 */
export function OrbifoldsExplorer() {
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupType>("P1");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expansion, setExpansion] = useState(DEFAULT_EXPANSION);
  
  // Initialize orbifold grid
  const [orbifoldGrid, setOrbifoldGrid] = useState<OrbifoldGrid<ColorData>>(() =>
    createOrbifoldGrid(wallpaperGroup, size)
  );

  // Recreate grid when wallpaper group or size changes
  useEffect(() => {
    setOrbifoldGrid(createOrbifoldGrid(wallpaperGroup, size));
  }, [wallpaperGroup, size]);

  // Handle cell click to toggle color
  const handleCellClick = useCallback((row: number, col: number) => {
    setOrbifoldGrid((prev) => {
      // Create a shallow copy of the grid
      const newGrid: OrbifoldGrid<ColorData> = {
        nodes: new Map(prev.nodes),
        edges: prev.edges,
        adjacency: prev.adjacency,
      };
      
      // Toggle the color
      const currentColor = getNodeColor(prev, row, col);
      const newColor = currentColor === "black" ? "white" : "black";
      setNodeColor(newGrid, row, col, newColor);
      
      return newGrid;
    });
  }, []);

  // Build the lifted graph
  const liftedGraph = useMemo(() => {
    const lifted = constructLiftedGraphFromOrbifold<ColorData>(orbifoldGrid);
    
    // Expand the graph m times
    for (let i = 0; i < expansion; i++) {
      processAllNonInteriorOnce(lifted);
    }
    
    return lifted;
  }, [orbifoldGrid, expansion]);

  return (
    <div className="orbifolds-explorer" style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "20px" }}>🔮 Orbifolds Explorer</h1>
      
      {/* Controls */}
      <div style={{ 
        display: "flex", 
        flexWrap: "wrap",
        gap: "20px", 
        marginBottom: "20px",
        padding: "16px",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px",
      }}>
        {/* Wallpaper Group Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label>Wallpaper Group:</label>
          <select
            value={wallpaperGroup}
            onChange={(e) => setWallpaperGroup(e.target.value as WallpaperGroupType)}
            style={{
              padding: "4px 8px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
          >
            <option value="P1">P1 (Torus)</option>
            <option value="P2">P2 (180° rotation)</option>
          </select>
        </div>
        
        {/* Size Input */}
        <ValidatedInput
          value={size}
          onChange={setSize}
          min={1}
          max={10}
          label="Size (n)"
        />
        
        {/* Expansion Input */}
        <ValidatedInput
          value={expansion}
          onChange={setExpansion}
          min={0}
          max={20}
          label="Expansion (m)"
        />
      </div>
      
      {/* Main content area */}
      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap" }}>
        {/* Coloring Grid */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Coloring Grid ({size}×{size})</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Click cells to toggle black/white
          </p>
          <ColoringGrid
            n={size}
            grid={orbifoldGrid}
            onCellClick={handleCellClick}
          />
          
          {/* Stats */}
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
            <p>Orbifold nodes: {orbifoldGrid.nodes.size}</p>
            <p>Orbifold edges: {orbifoldGrid.edges.size}</p>
          </div>
        </div>
        
        {/* Lifted Graph */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Lifted Graph</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
          </p>
          <LiftedGraphRenderer
            liftedGraph={liftedGraph}
            orbifoldGrid={orbifoldGrid}
          />
          
          {/* Legend */}
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
            <p>
              <span style={{ color: "#27ae60" }}>●</span> Interior nodes
              <span style={{ marginLeft: "16px", color: "#e74c3c" }}>○</span> Exterior nodes
            </p>
          </div>
        </div>
      </div>
      
      {/* Help text */}
      <div style={{ 
        marginTop: "30px", 
        padding: "16px", 
        backgroundColor: "#e8f4f8", 
        borderRadius: "8px",
        fontSize: "14px",
      }}>
        <h4 style={{ marginBottom: "8px" }}>About Orbifolds</h4>
        <p>
          An <strong>orbifold</strong> is a generalization of a surface that captures symmetry.
          The <strong>lifted graph</strong> shows how the fundamental domain tiles under the symmetry group.
        </p>
        <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
          <li><strong>P1:</strong> Simple torus wrapping (translations only)</li>
          <li><strong>P2:</strong> Includes 180° rotations at boundaries</li>
        </ul>
        <p style={{ marginTop: "8px" }}>
          Increase <strong>expansion (m)</strong> to see more of the lifted graph unfold.
        </p>
      </div>
    </div>
  );
}

export default OrbifoldsExplorer;
