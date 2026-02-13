/**
 * Orbifolds Explorer Page
 * 
 * Allows a user to:
 * - Select a wallpaper group (P1, P2, or P4)
 * - Set a size n (creating an n×n coloring grid)
 * - Set an expansion count m (how many times to expand the lifted graph)
 * - Color in the grid cells (black/white) using "color" tool
 * - Inspect nodes to see coordinates, edges, and voltages using "inspect" tool
 * - See the generated lifted graph with highlighting for inspected nodes
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
  buildAdjacency,
  nodeIdFromCoord,
  type LiftedGraph,
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type Matrix3x3,
} from "./orbifoldbasics";
import "../App.css";

type ToolType = "color" | "inspect";

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
 * Edge info for inspection display.
 */
interface EdgeInfo {
  targetNodeId: OrbifoldNodeId;
  targetCoord: readonly [number, number];
  voltage: Matrix3x3;
}

/**
 * Information about an inspected node.
 */
interface InspectionInfo {
  nodeId: OrbifoldNodeId;
  coord: readonly [number, number];
  edges: EdgeInfo[];
}

/**
 * Format a voltage matrix for display as multiple lines.
 */
function formatVoltageRows(v: Matrix3x3): string[] {
  return [
    `[${v[0].join(", ")}]`,
    `[${v[1].join(", ")}]`,
    `[${v[2].join(", ")}]`,
  ];
}

/**
 * Orbifold Grid Tools component - supports both color and inspect tools.
 */
function OrbifoldGridTools({
  n,
  grid,
  tool,
  onColorToggle,
  onInspect,
  inspectedNodeId,
}: {
  n: number;
  grid: OrbifoldGrid<ColorData>;
  tool: ToolType;
  onColorToggle: (row: number, col: number) => void;
  onInspect: (info: InspectionInfo | null) => void;
  inspectedNodeId: OrbifoldNodeId | null;
}) {
  const cellSize = CELL_SIZE;
  const width = n * cellSize + 2 * GRID_PADDING;
  const height = n * cellSize + 2 * GRID_PADDING;

  // Get odd coord from grid index
  const getOddCoord = (index: number): number => 2 * index + 1;

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - GRID_PADDING;
    const y = e.clientY - rect.top - GRID_PADDING;
    
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    
    if (row >= 0 && row < n && col >= 0 && col < n) {
      if (tool === "color") {
        onColorToggle(row, col);
      } else {
        // Inspect tool
        const i = getOddCoord(col);
        const j = getOddCoord(row);
        const nodeId = nodeIdFromCoord([i, j]);
        
        // Get edges for this node (adjacency is built during grid creation)
        const edgeIds = grid.adjacency?.get(nodeId) ?? [];
        const edges: EdgeInfo[] = [];
        
        for (const edgeId of edgeIds) {
          const edge = grid.edges.get(edgeId);
          if (!edge) continue;
          
          const halfEdge = edge.halfEdges.get(nodeId);
          if (!halfEdge) continue;
          
          const targetNode = grid.nodes.get(halfEdge.to);
          if (!targetNode) continue;
          
          edges.push({
            targetNodeId: halfEdge.to,
            targetCoord: targetNode.coord,
            voltage: halfEdge.voltage,
          });
        }
        
        onInspect({
          nodeId,
          coord: [i, j],
          edges,
        });
      }
    }
  };

  return (
    <svg
      width={width}
      height={height}
      style={{ 
        border: "1px solid #ccc", 
        borderRadius: "4px", 
        cursor: tool === "color" ? "pointer" : "crosshair" 
      }}
      onClick={handleSvgClick}
    >
      {/* Grid cells */}
      {Array.from({ length: n }, (_, row) =>
        Array.from({ length: n }, (_, col) => {
          const color = getNodeColor(grid, row, col);
          const x = GRID_PADDING + col * cellSize;
          const y = GRID_PADDING + row * cellSize;
          const i = getOddCoord(col);
          const j = getOddCoord(row);
          const nodeId = nodeIdFromCoord([i, j]);
          const isInspected = nodeId === inspectedNodeId;
          
          return (
            <g key={`${row}-${col}`}>
              <rect
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                fill={color === "black" ? "#2c3e50" : "white"}
                stroke={isInspected ? "#3498db" : "#7f8c8d"}
                strokeWidth={isInspected ? 3 : 1}
              />
              {/* Show coordinates when in inspect mode */}
              {tool === "inspect" && (
                <text
                  x={x + cellSize / 2}
                  y={y + cellSize / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill={color === "black" ? "#ecf0f1" : "#2c3e50"}
                  fontFamily="monospace"
                >
                  {i},{j}
                </text>
              )}
            </g>
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
 * Highlights nodes whose orbifold node matches the inspected node.
 */
function LiftedGraphRenderer({
  liftedGraph,
  orbifoldGrid,
  highlightOrbifoldNodeId,
}: {
  liftedGraph: LiftedGraph<ColorData>;
  orbifoldGrid: OrbifoldGrid<ColorData>;
  highlightOrbifoldNodeId?: OrbifoldNodeId | null;
}) {
  const cellSize = LIFTED_CELL_SIZE;
  
  // Compute positions and bounds
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number; color: "black" | "white"; orbifoldNodeId: OrbifoldNodeId }>();
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
      positions.set(id, { x: pos.x, y: pos.y, color, orbifoldNodeId: node.orbifoldNode });
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
        const isHighlighted = highlightOrbifoldNodeId && pos.orbifoldNodeId === highlightOrbifoldNodeId;
        
        return (
          <circle
            key={id}
            cx={toSvgX(pos.x)}
            cy={toSvgY(pos.y)}
            r={isHighlighted ? cellSize / 2 : cellSize / 3}
            fill={pos.color === "black" ? "#2c3e50" : "white"}
            stroke={isHighlighted ? "#3498db" : (isInterior ? "#27ae60" : "#e74c3c")}
            strokeWidth={isHighlighted ? 3 : (isInterior ? 1 : 2)}
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
  const [tool, setTool] = useState<ToolType>("color");
  const [inspectionInfo, setInspectionInfo] = useState<InspectionInfo | null>(null);
  
  // Initialize orbifold grid with adjacency built
  const [orbifoldGrid, setOrbifoldGrid] = useState<OrbifoldGrid<ColorData>>(() => {
    const grid = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(grid);
    return grid;
  });

  // Recreate grid when wallpaper group or size changes
  useEffect(() => {
    const grid = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(grid);
    setOrbifoldGrid(grid);
    setInspectionInfo(null); // Clear inspection when grid changes
  }, [wallpaperGroup, size]);

  // Handle cell color toggle
  const handleColorToggle = useCallback((row: number, col: number) => {
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

  // Handle inspection
  const handleInspect = useCallback((info: InspectionInfo | null) => {
    setInspectionInfo(info);
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
            <option value="P4">P4 (90° rotation)</option>
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
        {/* Orbifold Grid Section */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Orbifold Grid ({size}×{size})</h3>
          
          {/* Tool selector */}
          <div style={{ 
            display: "flex", 
            gap: "8px", 
            marginBottom: "10px",
          }}>
            <button
              onClick={() => setTool("color")}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: tool === "color" ? "2px solid #3498db" : "1px solid #ccc",
                backgroundColor: tool === "color" ? "#ebf5fb" : "white",
                cursor: "pointer",
                fontWeight: tool === "color" ? "bold" : "normal",
              }}
            >
              🎨 Color
            </button>
            <button
              onClick={() => setTool("inspect")}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: tool === "inspect" ? "2px solid #3498db" : "1px solid #ccc",
                backgroundColor: tool === "inspect" ? "#ebf5fb" : "white",
                cursor: "pointer",
                fontWeight: tool === "inspect" ? "bold" : "normal",
              }}
            >
              🔍 Inspect
            </button>
          </div>
          
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            {tool === "color" 
              ? "Click cells to toggle black/white" 
              : "Click cells to inspect node info and voltages"}
          </p>
          
          <OrbifoldGridTools
            n={size}
            grid={orbifoldGrid}
            tool={tool}
            onColorToggle={handleColorToggle}
            onInspect={handleInspect}
            inspectedNodeId={inspectionInfo?.nodeId ?? null}
          />
          
          {/* Stats */}
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
            <p>Orbifold nodes: {orbifoldGrid.nodes.size}</p>
            <p>Orbifold edges: {orbifoldGrid.edges.size}</p>
          </div>
          
          {/* Inspection Info Panel */}
          {inspectionInfo && (
            <div style={{ 
              marginTop: "16px", 
              padding: "12px", 
              backgroundColor: "#ebf5fb",
              borderRadius: "8px",
              border: "1px solid #3498db",
              maxWidth: "400px",
            }}>
              <h4 style={{ marginBottom: "8px", color: "#2980b9" }}>
                🔍 Node Inspection
              </h4>
              <p style={{ fontSize: "13px", marginBottom: "8px" }}>
                <strong>Node ID:</strong> <code style={{ backgroundColor: "#fff", padding: "2px 4px" }}>{inspectionInfo.nodeId}</code>
              </p>
              <p style={{ fontSize: "13px", marginBottom: "8px" }}>
                <strong>Coordinates:</strong> ({inspectionInfo.coord[0]}, {inspectionInfo.coord[1]})
              </p>
              <p style={{ fontSize: "13px", marginBottom: "4px" }}>
                <strong>Edges ({inspectionInfo.edges.length}):</strong>
              </p>
              <div style={{ 
                maxHeight: "200px", 
                overflowY: "auto",
                fontSize: "12px",
                fontFamily: "monospace",
              }}>
                {inspectionInfo.edges.map((edge, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      marginBottom: "8px", 
                      padding: "6px",
                      backgroundColor: "white",
                      borderRadius: "4px",
                    }}
                  >
                    <div><strong>→ Target:</strong> {edge.targetNodeId} ({edge.targetCoord[0]},{edge.targetCoord[1]})</div>
                    <div><strong>Voltage:</strong></div>
                    {formatVoltageRows(edge.voltage).map((row, rowIdx) => (
                      <div key={rowIdx} style={{ marginLeft: "10px" }}>{row}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Lifted Graph */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Lifted Graph</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
            {inspectionInfo && (
              <span style={{ color: "#3498db", marginLeft: "8px" }}>
                (highlighted: {inspectionInfo.nodeId})
              </span>
            )}
          </p>
          <LiftedGraphRenderer
            liftedGraph={liftedGraph}
            orbifoldGrid={orbifoldGrid}
            highlightOrbifoldNodeId={inspectionInfo?.nodeId}
          />
          
          {/* Legend */}
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
            <p>
              <span style={{ color: "#27ae60" }}>●</span> Interior nodes
              <span style={{ marginLeft: "16px", color: "#e74c3c" }}>○</span> Exterior nodes
              {inspectionInfo && (
                <>
                  <span style={{ marginLeft: "16px", color: "#3498db" }}>◉</span> Highlighted
                </>
              )}
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
          <li><strong>P4:</strong> Includes 90° rotations at boundaries (4-fold symmetry)</li>
        </ul>
        <p style={{ marginTop: "8px" }}>
          Use <strong>🎨 Color</strong> tool to paint cells, or <strong>🔍 Inspect</strong> tool to see node coordinates, edges, and voltage matrices.
        </p>
      </div>
    </div>
  );
}

export default OrbifoldsExplorer;
