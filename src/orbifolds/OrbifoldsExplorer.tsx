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

import { useState, useCallback, useMemo, useEffect, Component, type ReactNode } from "react";
import {
  createOrbifoldGrid,
  setNodeColor,
  getNodeColor,
  getEdgeLinestyle,
  type WallpaperGroupType,
  type ColorData,
  type EdgeStyleData,
  type EdgeLinestyle,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  nodeIdFromCoord,
  type LiftedGraph,
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type Matrix3x3,
} from "./orbifoldbasics";
import { Graph, kruskalMST } from "@graphty/algorithms";
import "../App.css";

type ToolType = "color" | "inspect";

/**
 * Error Boundary component to catch React errors and prevent white screen of death.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "40px",
          textAlign: "center",
          backgroundColor: "#fee",
          borderRadius: "8px",
          margin: "20px",
        }}>
          <h2 style={{ color: "#c0392b" }}>⚠️ Something went wrong</h2>
          <p style={{ color: "#666", marginBottom: "20px" }}>
            {this.state.error?.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "10px 20px",
              backgroundColor: "#3498db",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Constants
const DEFAULT_SIZE = 3;
const DEFAULT_EXPANSION = 2;
const CELL_SIZE = 40;
const LIFTED_CELL_SIZE = 16;
const GRID_PADDING = 20;

/**
 * Constructs a random spanning tree of the white orbifold nodes using Kruskal's algorithm
 * with random weights. Sets edges in the tree as solid and edges not in the tree as dashed.
 * 
 * @param grid - The orbifold grid to modify (edges will be updated in place)
 * @returns A new grid with updated edge linestyles
 */
function applyRandomSpanningTreeToWhiteNodes(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>
): OrbifoldGrid<ColorData, EdgeStyleData> {
  // Get all white nodes
  const whiteNodeIds = new Set<OrbifoldNodeId>();
  for (const [nodeId, node] of grid.nodes) {
    if (node.data?.color === "white") {
      whiteNodeIds.add(nodeId);
    }
  }

  // If we have 0 or 1 white nodes, nothing to do
  if (whiteNodeIds.size < 2) {
    // Just set all edges to dashed (no spanning tree possible)
    const newEdges = new Map(grid.edges);
    for (const [edgeId, edge] of newEdges) {
      newEdges.set(edgeId, { ...edge, data: { linestyle: "dashed" } });
    }
    return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
  }

  // Find edges that connect two white nodes
  const edgesBetweenWhiteNodes: OrbifoldEdgeId[] = [];
  for (const [edgeId, edge] of grid.edges) {
    // Get the two endpoint node IDs from the half-edges
    const endpoints = Array.from(edge.halfEdges.keys());
    const bothEndpointsWhite = endpoints.every(nodeId => whiteNodeIds.has(nodeId));
    
    if (bothEndpointsWhite) {
      edgesBetweenWhiteNodes.push(edgeId);
    }
  }

  // Build a graph for Kruskal's algorithm using @graphty/algorithms
  const kruskalGraph = new Graph({ directed: false });
  
  // Add white nodes
  for (const nodeId of whiteNodeIds) {
    kruskalGraph.addNode(nodeId);
  }
  
  // Track edges we've already added to avoid duplicates (parallel edges)
  const addedEdgePairs = new Set<string>();
  
  // Add edges with random weights
  const edgeToGraphEdge = new Map<OrbifoldEdgeId, { source: string; target: string }>();
  for (const edgeId of edgesBetweenWhiteNodes) {
    const edge = grid.edges.get(edgeId)!;
    const endpoints = Array.from(edge.halfEdges.keys());
    const [source, target] = endpoints.length === 1 
      ? [endpoints[0], endpoints[0]]  // Self-loop
      : endpoints;
    
    // Skip self-loops - they can't be part of a spanning tree
    if (source === target) {
      continue;
    }
    
    // Skip parallel edges - the graph library doesn't allow them
    const edgePairKey = source < target ? `${source}-${target}` : `${target}-${source}`;
    if (addedEdgePairs.has(edgePairKey)) {
      // Still track this edge for linestyle updates, but don't add to Kruskal graph
      edgeToGraphEdge.set(edgeId, { source, target });
      continue;
    }
    addedEdgePairs.add(edgePairKey);
    
    const randomWeight = Math.random();
    kruskalGraph.addEdge(source, target, randomWeight);
    edgeToGraphEdge.set(edgeId, { source, target });
  }

  // Run Kruskal's algorithm to get the minimum spanning tree (with random weights = random tree)
  let spanningTreeEdgeSet: Set<string>;
  try {
    const mstResult = kruskalMST(kruskalGraph);
    // Create a set of edges in the spanning tree (as "source-target" strings, sorted)
    spanningTreeEdgeSet = new Set(
      mstResult.edges.map(e => {
        const s = String(e.source);
        const t = String(e.target);
        return s < t ? `${s}-${t}` : `${t}-${s}`;
      })
    );
  } catch {
    // Graph is not connected - just set all edges to dashed
    const newEdges = new Map(grid.edges);
    for (const [edgeId, edge] of newEdges) {
      newEdges.set(edgeId, { ...edge, data: { linestyle: "dashed" } });
    }
    return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
  }

  // Update edge linestyles: solid if in spanning tree, dashed otherwise
  const newEdges = new Map(grid.edges);
  for (const [edgeId, edge] of newEdges) {
    const endpoints = Array.from(edge.halfEdges.keys());
    const bothEndpointsWhite = endpoints.every(nodeId => whiteNodeIds.has(nodeId));
    
    let linestyle: EdgeLinestyle;
    if (bothEndpointsWhite && endpoints.length === 2) {
      // Check if this edge is in the spanning tree
      const [source, target] = endpoints;
      const edgeKey = source < target ? `${source}-${target}` : `${target}-${source}`;
      linestyle = spanningTreeEdgeSet.has(edgeKey) ? "solid" : "dashed";
    } else {
      // Edge doesn't connect two different white nodes - set to dashed
      linestyle = "dashed";
    }
    
    newEdges.set(edgeId, { ...edge, data: { linestyle } });
  }

  return { nodes: grid.nodes, edges: newEdges, adjacency: grid.adjacency };
}

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
  edgeId: OrbifoldEdgeId;
  targetNodeId: OrbifoldNodeId;
  targetCoord: readonly [number, number];
  voltage: Matrix3x3;
  linestyle: EdgeLinestyle;
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
  grid: OrbifoldGrid<ColorData, EdgeStyleData>;
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
            edgeId,
            targetNodeId: halfEdge.to,
            targetCoord: targetNode.coord,
            voltage: halfEdge.voltage,
            linestyle: getEdgeLinestyle(grid, edgeId),
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
 * Apply axial-to-Cartesian transformation.
 * Axial coords (q, r) map to Cartesian (x, y) via:
 * x = q + r * 0.5
 * y = r * sqrt(3)/2
 */
function axialToCartesian(q: number, r: number): { x: number; y: number } {
  return {
    x: q + r * 0.5,
    y: r * Math.sqrt(3) / 2,
  };
}

/**
 * Lifted graph renderer.
 * Positions each lifted node using: voltage × orbifold node coordinates.
 * Colors each node using the ExtraData color from the orbifold node.
 * Highlights nodes whose orbifold node matches the inspected node.
 * 
 * For P3 (axial coordinates), an optional transform can be applied to convert
 * axial coordinates to Cartesian for better visualization.
 */
/**
 * Serialize a voltage matrix to a string key for uniqueness comparison.
 */
function voltageToKey(v: Matrix3x3): string {
  return v.map(row => row.join(',')).join(';');
}

/**
 * Generate a color from a voltage key for domain visualization.
 */
function colorFromVoltageKey(key: string, alpha: number = 0.15): string {
  // Simple hash to generate a hue
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash = hash | 0; // Convert to 32bit integer (safe for overflow)
  }
  const hue = Math.abs(hash) % 360;
  return `hsla(${hue}, 70%, 50%, ${alpha})`;
}

function LiftedGraphRenderer({
  liftedGraph,
  orbifoldGrid,
  highlightOrbifoldNodeId,
  useAxialTransform = false,
  fundamentalDomainSize,
  selectedVoltageKey,
  onNodeClick,
  showDomains = true,
  showDashedLines = true,
}: {
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  highlightOrbifoldNodeId?: OrbifoldNodeId | null;
  useAxialTransform?: boolean;
  fundamentalDomainSize: number;
  selectedVoltageKey: string | null;
  onNodeClick: (liftedNodeId: string, voltageKey: string) => void;
  showDomains?: boolean;
  showDashedLines?: boolean;
}) {
  const cellSize = LIFTED_CELL_SIZE;
  
  // Compute positions, bounds, and collect unique voltages
  const { nodePositions, uniqueVoltages } = useMemo(() => {
    const positions = new Map<string, { 
      x: number; 
      y: number; 
      color: "black" | "white"; 
      orbifoldNodeId: OrbifoldNodeId;
      voltageKey: string;
    }>();
    const voltages = new Map<string, Matrix3x3>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    for (const [id, node] of liftedGraph.nodes) {
      const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
      if (!orbNode) continue;
      
      // Track unique voltages
      const voltageKey = voltageToKey(node.voltage);
      if (!voltages.has(voltageKey)) {
        voltages.set(voltageKey, node.voltage);
      }
      
      // Position = voltage × orbifold node coordinates
      const [ox, oy] = orbNode.coord;
      let pos = applyMatrix(node.voltage, ox, oy);
      
      // Optionally apply axial-to-Cartesian transform for P3
      if (useAxialTransform) {
        pos = axialToCartesian(pos.x, pos.y);
      }
      
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
      
      const color = orbNode.data?.color ?? "white";
      positions.set(id, { x: pos.x, y: pos.y, color, orbifoldNodeId: node.orbifoldNode, voltageKey });
    }
    
    return { 
      nodePositions: { positions, minX, maxX, minY, maxY },
      uniqueVoltages: voltages,
    };
  }, [liftedGraph, orbifoldGrid, useAxialTransform]);

  const { positions, minX, maxX, minY, maxY } = nodePositions;
  
  // Compute transformed fundamental domains for each unique voltage
  const transformedDomains = useMemo(() => {
    const domains: Array<{
      key: string;
      corners: Array<{ x: number; y: number }>;
      color: string;
    }> = [];
    
    // The fundamental domain corners: (0, 0), (2n, 0), (2n, 2n), (0, 2n)
    const domainSize = fundamentalDomainSize * 2; // 2n
    const originalCorners = [
      { x: 0, y: 0 },
      { x: domainSize, y: 0 },
      { x: domainSize, y: domainSize },
      { x: 0, y: domainSize },
    ];
    
    for (const [key, voltage] of uniqueVoltages) {
      const transformedCorners = originalCorners.map(corner => {
        let pos = applyMatrix(voltage, corner.x, corner.y);
        if (useAxialTransform) {
          pos = axialToCartesian(pos.x, pos.y);
        }
        return pos;
      });
      
      domains.push({
        key,
        corners: transformedCorners,
        color: colorFromVoltageKey(key),
      });
    }
    
    return domains;
  }, [uniqueVoltages, fundamentalDomainSize, useAxialTransform]);
  
  // Compute SVG dimensions with padding - include domain corners in bounds
  const allBounds = useMemo(() => {
    let bMinX = minX, bMaxX = maxX, bMinY = minY, bMaxY = maxY;
    for (const domain of transformedDomains) {
      for (const corner of domain.corners) {
        bMinX = Math.min(bMinX, corner.x);
        bMaxX = Math.max(bMaxX, corner.x);
        bMinY = Math.min(bMinY, corner.y);
        bMaxY = Math.max(bMaxY, corner.y);
      }
    }
    return { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
  }, [minX, maxX, minY, maxY, transformedDomains]);
  
  const padding = GRID_PADDING * 2;
  const rangeX = allBounds.maxX - allBounds.minX || 1;
  const rangeY = allBounds.maxY - allBounds.minY || 1;
  const scale = cellSize;
  const width = rangeX * scale + 2 * padding;
  const height = rangeY * scale + 2 * padding;

  // Transform coordinates to SVG space
  const toSvgX = (x: number) => padding + (x - allBounds.minX) * scale;
  const toSvgY = (y: number) => padding + (y - allBounds.minY) * scale;

  return (
    <svg
      width={Math.max(width, 200)}
      height={Math.max(height, 200)}
      style={{ border: "1px solid #ccc", borderRadius: "4px", backgroundColor: "#f8f9fa" }}
    >
      {/* Transformed fundamental domains (drawn first, behind everything) */}
      {showDomains && transformedDomains.map((domain) => {
        const isSelected = domain.key === selectedVoltageKey;
        const points = domain.corners
          .map(c => `${toSvgX(c.x)},${toSvgY(c.y)}`)
          .join(' ');
        
        return (
          <polygon
            key={`domain-${domain.key}`}
            points={points}
            fill={isSelected ? colorFromVoltageKey(domain.key, 0.4) : domain.color}
            stroke={isSelected ? colorFromVoltageKey(domain.key, 1.0) : colorFromVoltageKey(domain.key, 0.5)}
            strokeWidth={isSelected ? 3 : 1}
          />
        );
      })}
      
      {/* Edges */}
      {Array.from(liftedGraph.edges.values()).map((edge) => {
        const posA = positions.get(edge.a);
        const posB = positions.get(edge.b);
        if (!posA || !posB) return null;
        
        // Get linestyle from orbifold edge
        const orbifoldEdge = edge.orbifoldEdgeId ? orbifoldGrid.edges.get(edge.orbifoldEdgeId) : undefined;
        const linestyle = orbifoldEdge?.data?.linestyle ?? "solid";
        
        // Hide dashed lines if showDashedLines is false
        if (linestyle === "dashed" && !showDashedLines) {
          return null;
        }
        
        // Solid lines: thick black paths; Dashed lines: thin gray dashed
        const isSolid = linestyle === "solid";
        
        return (
          <line
            key={edge.id}
            x1={toSvgX(posA.x)}
            y1={toSvgY(posA.y)}
            x2={toSvgX(posB.x)}
            y2={toSvgY(posB.y)}
            stroke={isSolid ? "#000000" : "#bdc3c7"}
            strokeWidth={isSolid ? 3 : 1}
            strokeDasharray={isSolid ? undefined : "4,3"}
            strokeLinecap={isSolid ? "round" : undefined}
          />
        );
      })}
      
      {/* Nodes */}
      {Array.from(positions.entries()).map(([id, pos]) => {
        const node = liftedGraph.nodes.get(id);
        const isInterior = node?.interior ?? false;
        const isHighlighted = highlightOrbifoldNodeId && pos.orbifoldNodeId === highlightOrbifoldNodeId;
        const isVoltageSelected = pos.voltageKey === selectedVoltageKey;
        
        return (
          <circle
            key={id}
            cx={toSvgX(pos.x)}
            cy={toSvgY(pos.y)}
            r={isHighlighted || isVoltageSelected ? cellSize / 2 : cellSize / 3}
            fill={pos.color === "black" ? "#2c3e50" : "white"}
            stroke={
              isVoltageSelected ? colorFromVoltageKey(pos.voltageKey, 1.0) :
              isHighlighted ? "#3498db" : 
              (isInterior ? "#27ae60" : "#e74c3c")
            }
            strokeWidth={isHighlighted || isVoltageSelected ? 3 : (isInterior ? 1 : 2)}
            style={{ cursor: "pointer" }}
            onClick={() => onNodeClick(id, pos.voltageKey)}
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
  const [useAxialTransform, setUseAxialTransform] = useState(false);
  const [selectedVoltageKey, setSelectedVoltageKey] = useState<string | null>(null);
  const [showDomains, setShowDomains] = useState(true);
  const [showDashedLines, setShowDashedLines] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Initialize orbifold grid with adjacency built
  const [orbifoldGrid, setOrbifoldGrid] = useState<OrbifoldGrid<ColorData, EdgeStyleData>>(() => {
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
    setSelectedVoltageKey(null); // Clear voltage selection when grid changes
  }, [wallpaperGroup, size]);

  // Handle cell color toggle
  const handleColorToggle = useCallback((row: number, col: number) => {
    setOrbifoldGrid((prev) => {
      // Create a shallow copy of the grid
      const newGrid: OrbifoldGrid<ColorData, EdgeStyleData> = {
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

  // Handle edge linestyle toggle
  // Helper function to toggle linestyle
  const toggleLinestyle = (current: EdgeLinestyle): EdgeLinestyle => 
    current === "solid" ? "dashed" : "solid";

  const handleEdgeLinestyleToggle = useCallback((edgeId: OrbifoldEdgeId) => {
    setOrbifoldGrid((prev) => {
      // Create a shallow copy of the grid with edges also copied
      const newEdges = new Map(prev.edges);
      const edge = newEdges.get(edgeId);
      if (edge) {
        const currentLinestyle = edge.data?.linestyle ?? "solid";
        const newLinestyle = toggleLinestyle(currentLinestyle);
        newEdges.set(edgeId, { ...edge, data: { linestyle: newLinestyle } });
      }
      
      const newGrid: OrbifoldGrid<ColorData, EdgeStyleData> = {
        nodes: prev.nodes,
        edges: newEdges,
        adjacency: prev.adjacency,
      };
      
      return newGrid;
    });
    
    // Also update the inspection info to reflect the new linestyle
    setInspectionInfo((prevInfo) => {
      if (!prevInfo) return null;
      return {
        ...prevInfo,
        edges: prevInfo.edges.map((e) => {
          if (e.edgeId === edgeId) {
            return {
              ...e,
              linestyle: toggleLinestyle(e.linestyle),
            };
          }
          return e;
        }),
      };
    });
  }, []);

  // Handle inspection
  const handleInspect = useCallback((info: InspectionInfo | null) => {
    setInspectionInfo(info);
  }, []);

  // Handle random spanning tree button click
  const handleRandomSpanningTree = useCallback(() => {
    try {
      setErrorMessage(null); // Clear any previous error
      setOrbifoldGrid((prev) => {
        const newGrid = applyRandomSpanningTreeToWhiteNodes(prev);
        return newGrid;
      });
      // Clear inspection info since edge linestyles have changed
      setInspectionInfo(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred";
      setErrorMessage(`Random tree generation failed: ${message}`);
      console.error("Random spanning tree error:", error);
    }
  }, []);

  // Handle lifted node click (for domain highlighting)
  // Note: liftedNodeId is available for future extension (e.g., showing node details)
  const handleLiftedNodeClick = useCallback((_liftedNodeId: string, voltageKey: string) => {
    // Toggle selection: if same voltage is clicked again, deselect
    setSelectedVoltageKey(prev => prev === voltageKey ? null : voltageKey);
  }, []);

  // Build the lifted graph
  const liftedGraph = useMemo(() => {
    const lifted = constructLiftedGraphFromOrbifold<ColorData, EdgeStyleData>(orbifoldGrid);
    
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
            <option value="P3">P3 (120° rotation - axial)</option>
            <option value="P4">P4 (90° rotation)</option>
          </select>
        </div>
        
        {/* Size Input */}
        <ValidatedInput
          value={size}
          onChange={setSize}
          min={2}
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
        
        {/* Axial Transform Checkbox (only visible for P3) */}
        {wallpaperGroup === "P3" && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={useAxialTransform}
                onChange={(e) => setUseAxialTransform(e.target.checked)}
              />
              Show axial coordinates
            </label>
          </div>
        )}
      </div>
      
      {/* Error message display */}
      {errorMessage && (
        <div style={{
          padding: "12px 16px",
          marginBottom: "20px",
          backgroundColor: "#fee",
          border: "1px solid #e74c3c",
          borderRadius: "8px",
          color: "#c0392b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>⚠️ {errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "#c0392b",
            }}
          >
            ✕
          </button>
        </div>
      )}
      
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
            <button
              onClick={handleRandomSpanningTree}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #27ae60",
                backgroundColor: "#e8f6ef",
                cursor: "pointer",
              }}
              title="Generate a random spanning tree of white nodes (solid = in tree, dashed = not in tree)"
            >
              🌲 Random Tree
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
                    <div><strong>Edge ID:</strong> <code style={{ backgroundColor: "#f0f0f0", padding: "1px 3px", fontSize: "11px" }}>{edge.edgeId}</code></div>
                    <div><strong>→ Target:</strong> {edge.targetNodeId} ({edge.targetCoord[0]},{edge.targetCoord[1]})</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <strong>Linestyle:</strong>
                      <button
                        onClick={() => handleEdgeLinestyleToggle(edge.edgeId)}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          borderRadius: "4px",
                          border: "1px solid #3498db",
                          backgroundColor: edge.linestyle === "dashed" ? "#ebf5fb" : "white",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <svg width="24" height="8" style={{ verticalAlign: "middle" }}>
                          <line
                            x1="2"
                            y1="4"
                            x2="22"
                            y2="4"
                            stroke="#3498db"
                            strokeWidth="2"
                            strokeDasharray={edge.linestyle === "dashed" ? "4,3" : undefined}
                          />
                        </svg>
                        {edge.linestyle}
                      </button>
                    </div>
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
          <h3 style={{ marginBottom: "10px" }}>Lifted Graph{wallpaperGroup === "P3" && useAxialTransform ? " (Axial → Cartesian)" : ""}</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
            {inspectionInfo && (
              <span style={{ color: "#3498db", marginLeft: "8px" }}>
                (highlighted: {inspectionInfo.nodeId})
              </span>
            )}
          </p>
          
          {/* Display options */}
          <div style={{ 
            display: "flex", 
            gap: "16px", 
            marginBottom: "10px",
            fontSize: "12px",
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showDomains}
                onChange={(e) => setShowDomains(e.target.checked)}
              />
              Show domains
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showDashedLines}
                onChange={(e) => setShowDashedLines(e.target.checked)}
              />
              Show dashed lines
            </label>
          </div>
          
          <LiftedGraphRenderer
            liftedGraph={liftedGraph}
            orbifoldGrid={orbifoldGrid}
            highlightOrbifoldNodeId={inspectionInfo?.nodeId}
            useAxialTransform={wallpaperGroup === "P3" && useAxialTransform}
            fundamentalDomainSize={size}
            selectedVoltageKey={selectedVoltageKey}
            onNodeClick={handleLiftedNodeClick}
            showDomains={showDomains}
            showDashedLines={showDashedLines}
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
              {selectedVoltageKey && (
                <>
                  <span style={{ marginLeft: "16px" }}>▢</span> Selected domain (click node to highlight)
                </>
              )}
            </p>
            <p style={{ marginTop: "4px" }}>
              Click on a lifted node to highlight its fundamental domain.
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
          <li><strong>P3:</strong> Includes 120° rotations at boundaries (3-fold symmetry, uses axial coordinates)</li>
          <li><strong>P4:</strong> Includes 90° rotations at boundaries (4-fold symmetry)</li>
        </ul>
        <p style={{ marginTop: "8px" }}>
          Use <strong>🎨 Color</strong> tool to paint cells, or <strong>🔍 Inspect</strong> tool to see node coordinates, edges, and voltage matrices.
        </p>
        {wallpaperGroup === "P3" && (
          <p style={{ marginTop: "8px", color: "#666" }}>
            <strong>Note:</strong> P3 uses axial coordinates for 120° rotations. Neighbor distances in the lifted graph 
            may appear non-uniform in Cartesian display. Check "Show axial coordinates" for the transformed view.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Wrapped OrbifoldsExplorer with Error Boundary for graceful error handling.
 */
function OrbifoldsExplorerWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <OrbifoldsExplorer />
    </ErrorBoundary>
  );
}

export default OrbifoldsExplorerWithErrorBoundary;
