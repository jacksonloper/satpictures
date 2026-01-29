import React from "react";
import type { ColorGrid, GridSolution, GridType } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  getHexDimensions,
  getHexCenter,
  getCairoTile,
  createCairoTransformer,
  polyCentroid,
} from "./gridConstants";

interface GraphModeRendererProps {
  grid: ColorGrid;
  solution: GridSolution;
  cellSize: number;
  gridType: GridType;
  totalWidth: number;
  totalHeight: number;
  wallThickness: number;
}

export const GraphModeRenderer: React.FC<GraphModeRendererProps> = ({
  grid,
  solution,
  cellSize,
  gridType,
  totalWidth,
  totalHeight,
  wallThickness,
}) => {
  const svgWidth = totalWidth;
  const svgHeight = totalHeight;
  const padding = wallThickness;
  
  // Graph mode sizing constants (as fractions of cellSize)
  const GRAPH_NODE_RADIUS_RATIO = 0.08; // Small dots for nodes
  const GRAPH_EDGE_WIDTH_RATIO = 0.06; // Thin lines for edges
  const nodeRadius = cellSize * GRAPH_NODE_RADIUS_RATIO;
  const edgeWidth = cellSize * GRAPH_EDGE_WIDTH_RATIO;
  
  // Hex grid calculations
  const { hexSize, hexWidth, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);
  
  // Helper to get display color for a cell
  const getNodeColor = (row: number, col: number): string => {
    const displayColor = solution.assignedColors[row][col];
    const isHatch = displayColor === HATCH_COLOR;
    
    if (isHatch) {
      return "#ff9800"; // Orange for hatch
    } else {
      return COLORS[(displayColor ?? 0) % COLORS.length];
    }
  };
  
  // Compute node centroids based on grid type
  interface NodeData {
    row: number;
    col: number;
    cx: number;
    cy: number;
    color: string;
  }
  
  const nodes: NodeData[] = [];
  
  if (gridType === "square") {
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = col * cellSize + cellSize / 2;
        const cy = row * cellSize + cellSize / 2;
        nodes.push({ row, col, cx, cy, color: getNodeColor(row, col) });
      }
    }
  } else if (gridType === "hex") {
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
        nodes.push({ row, col, cx, cy, color: getNodeColor(row, col) });
      }
    }
  } else if (gridType === "octagon") {
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        nodes.push({ row, col, cx, cy, color: getNodeColor(row, col) });
      }
    }
  } else if (gridType === "cairo" || gridType === "cairobridge") {
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const centroid = toSvg(polyCentroid(tile));
        nodes.push({ row, col, cx: centroid[0], cy: centroid[1], color: getNodeColor(row, col) });
      }
    }
  }
  
  // Create a lookup map for node positions
  const nodeMap = new Map<string, NodeData>();
  for (const node of nodes) {
    nodeMap.set(`${node.row},${node.col}`, node);
  }
  
  // Compute edges from kept edges
  interface EdgeData {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    // For octagon/cairobridge: track if this is a diagonal edge and its type
    isDiagonal?: boolean;
    isDownSlant?: boolean; // true = down-slant (NW-SE), false = up-slant (NE-SW)
  }
  
  const edges: EdgeData[] = [];
  
  // Helper to check if an edge is diagonal (different row AND different col)
  const isDiagonalEdge = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
    return e.u.row !== e.v.row && e.u.col !== e.v.col;
  };
  
  // Helper to determine if a diagonal is down-slant (NW-SE) or up-slant (NE-SW)
  const isDownSlantDiagonal = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
    // Down-slant: when going from smaller row to larger row, col also increases
    // (row increases, col increases) OR (row decreases, col decreases)
    const dRow = e.v.row - e.u.row;
    const dCol = e.v.col - e.u.col;
    return (dRow > 0 && dCol > 0) || (dRow < 0 && dCol < 0);
  };
  
  for (const edge of solution.keptEdges) {
    const node1 = nodeMap.get(`${edge.u.row},${edge.u.col}`);
    const node2 = nodeMap.get(`${edge.v.row},${edge.v.col}`);
    
    if (node1 && node2) {
      const diagonal = isDiagonalEdge(edge);
      const downSlant = diagonal ? isDownSlantDiagonal(edge) : undefined;
      
      edges.push({
        x1: node1.cx,
        y1: node1.cy,
        x2: node2.cx,
        y2: node2.cy,
        color: node1.color,
        isDiagonal: diagonal,
        isDownSlant: downSlant,
      });
    }
  }
  
  // For octagon and cairobridge, we need to handle crossing edges with bridges
  // Separate edges into regular edges and crossing diagonal pairs
  const regularEdges: EdgeData[] = [];
  const downSlantEdges: EdgeData[] = [];
  const upSlantEdges: EdgeData[] = [];
  
  if (gridType === "octagon") {
    for (const edge of edges) {
      if (edge.isDiagonal) {
        if (edge.isDownSlant) {
          downSlantEdges.push(edge);
        } else {
          upSlantEdges.push(edge);
        }
      } else {
        regularEdges.push(edge);
      }
    }
  } else if (gridType === "cairobridge") {
    // For cairobridge, identify bridge diagonals (non-Cairo diagonals)
    for (const edge of edges) {
      if (edge.isDiagonal) {
        // Treat all diagonals as potential crossing edges
        // Down-slant vs up-slant determines layer
        if (edge.isDownSlant) {
          downSlantEdges.push(edge);
        } else {
          upSlantEdges.push(edge);
        }
      } else {
        regularEdges.push(edge);
      }
    }
  } else {
    // For other grid types, all edges are regular
    regularEdges.push(...edges);
  }
  
  // Compute bridge rectangles for crossing edges
  // The bridge is a white-filled rectangle that the "over" edge passes through
  interface BridgeData {
    path: string;
  }
  
  const bridges: BridgeData[] = [];
  // Bridge sizing ratios - chosen for visual clarity at typical cell sizes
  const BRIDGE_WIDTH_RATIO = 0.12; // Width of the white bridge perpendicular to edge
  const BRIDGE_LENGTH_RATIO = 0.25; // Length of the bridge section along the edge
  const bridgeWidth = cellSize * BRIDGE_WIDTH_RATIO;
  
  // For up-slant edges (which go "over"), create bridges at crossing points
  if (gridType === "octagon" || gridType === "cairobridge") {
    for (const upEdge of upSlantEdges) {
      // Direction vector of the edge
      const dx = upEdge.x2 - upEdge.x1;
      const dy = upEdge.y2 - upEdge.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      // Skip zero-length edges to avoid division by zero
      if (len < 0.001) continue;
      
      // Find the midpoint of this edge (where it crosses)
      const midX = (upEdge.x1 + upEdge.x2) / 2;
      const midY = (upEdge.y1 + upEdge.y2) / 2;
      
      const unitX = dx / len;
      const unitY = dy / len;
      
      // Perpendicular vector
      const perpX = -unitY;
      const perpY = unitX;
      
      // Bridge extends bridgeWidth/2 perpendicular on each side
      // and BRIDGE_LENGTH_RATIO * len along the edge direction
      const halfLen = len * BRIDGE_LENGTH_RATIO / 2;
      const halfWidth = bridgeWidth / 2;
      
      // Four corners of the bridge
      const c1x = midX - unitX * halfLen + perpX * halfWidth;
      const c1y = midY - unitY * halfLen + perpY * halfWidth;
      const c2x = midX - unitX * halfLen - perpX * halfWidth;
      const c2y = midY - unitY * halfLen - perpY * halfWidth;
      const c3x = midX + unitX * halfLen - perpX * halfWidth;
      const c3y = midY + unitY * halfLen - perpY * halfWidth;
      const c4x = midX + unitX * halfLen + perpX * halfWidth;
      const c4y = midY + unitY * halfLen + perpY * halfWidth;
      
      const bridgePath = `M ${c1x} ${c1y} L ${c2x} ${c2y} L ${c3x} ${c3y} L ${c4x} ${c4y} Z`;
      bridges.push({ path: bridgePath });
    }
  }
  
  return (
    <div
      className="grid-container"
      style={{
        position: "relative",
        userSelect: "none",
      }}
    >
      <svg width={svgWidth} height={svgHeight} style={{ display: "block", backgroundColor: "#f5f5f5" }}>
        {/* Layer 1: Regular edges (non-diagonal) */}
        {regularEdges.map((edge, i) => (
          <line
            key={`regular-edge-${i}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edgeWidth}
            strokeLinecap="round"
          />
        ))}
        
        {/* Layer 2: Down-slant diagonal edges (go "under") */}
        {downSlantEdges.map((edge, i) => (
          <line
            key={`down-edge-${i}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edgeWidth}
            strokeLinecap="round"
          />
        ))}
        
        {/* Layer 3: White bridges for up-slant edges */}
        {bridges.map((bridge, i) => (
          <path
            key={`bridge-${i}`}
            d={bridge.path}
            fill="white"
            stroke="none"
          />
        ))}
        
        {/* Layer 4: Up-slant diagonal edges (go "over") */}
        {upSlantEdges.map((edge, i) => (
          <line
            key={`up-edge-${i}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edgeWidth}
            strokeLinecap="round"
          />
        ))}
        
        {/* Layer 5: Render nodes as small dots on top */}
        {nodes.map(({ row, col, cx, cy, color }) => (
          <circle
            key={`node-${row}-${col}`}
            cx={cx}
            cy={cy}
            r={nodeRadius}
            fill={color}
          />
        ))}
      </svg>
    </div>
  );
};
